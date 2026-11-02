import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { beginOAuth, completeOAuth } from '../src/oauth.mjs';

test('beginOAuth creates bounded PKCE state and Etsy authorization URL', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'etsy-hub-oauth-'));
  const credential = path.join(dir, 'main.json');
  const stateDir = path.join(dir, 'state');
  await fs.writeFile(credential, JSON.stringify({ client_id: 'key123', secret: 'secret456' }));

  const config = {
    default_shop: 'main',
    oauth_state_dir: stateDir,
    shops: { main: { shop_id: '12345678', credential_file: credential } },
  };
  const result = await beginOAuth({
    config,
    shopAlias: 'main',
    redirectUri: 'https://example.test/oauth/callback',
    scopes: ['listings_r', 'listings_w'],
  });
  const url = new URL(result.authorization_url);
  assert.equal(url.origin, 'https://www.etsy.com');
  assert.equal(url.pathname, '/oauth/connect');
  assert.equal(url.searchParams.get('client_id'), 'key123');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://example.test/oauth/callback');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('code_challenge'));
  assert.equal(url.searchParams.get('state'), result.state);

  const state = JSON.parse(await fs.readFile(path.join(stateDir, result.state + '.json'), 'utf8'));
  assert.equal(state.expected_shop_id, '12345678');
  assert.ok(state.verifier);
  if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(stateDir, result.state + '.json'))).mode & 0o777, 0o600);
});

test('OAuth state cannot be reused after a failed upstream exchange', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'etsy-oauth-once-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const credential = path.join(dir, 'credentials.json');
  await fs.writeFile(credential, JSON.stringify({ client_id: 'example_key', secret: 'example_secret' }), { mode: 0o600 });
  const config = { default_shop: 'main', oauth_state_dir: path.join(dir, 'state'),
    shops: { main: { shop_id: '123', credential_file: credential } },
    oauth_scopes: ['shops_r'] };
  const issued = await beginOAuth({ config, redirectUri: 'https://example.test/callback' });
  let exchanges = 0;
  const fetchImpl = async () => {
    exchanges++;
    return new Response(JSON.stringify({ error_description: 'sensitive-marker-not-for-output' }), { status: 400 });
  };
  await assert.rejects(completeOAuth({ config, state: issued.state, code: 'badcode', fetchImpl }), err => {
    assert.equal(err.code, 'OAUTH_EXCHANGE_FAILED');
    assert.equal(err.message.includes('sensitive-marker'), false);
    return true;
  });
  await assert.rejects(completeOAuth({ config, state: issued.state, code: 'badcode', fetchImpl }), /missing or already used/);
  assert.equal(exchanges, 1);
});
test('concurrent OAuth callbacks never exchange the same one-time state twice', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'etsy-oauth-race-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const credential = path.join(dir, 'credentials.json');
  await fs.writeFile(credential, JSON.stringify({ client_id: 'example_key', secret: 'example_secret' }), { mode: 0o600 });
  const config = { default_shop: 'main', oauth_state_dir: path.join(dir, 'state'),
    shops: { main: { shop_id: '123', credential_file: credential } }, oauth_scopes: ['shops_r'] };
  const issued = await beginOAuth({ config, redirectUri: 'https://example.test/callback' });
  let exchanges = 0;
  const fetchImpl = async () => {
    exchanges++;
    return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
  };
  const results = await Promise.allSettled([
    completeOAuth({ config, state: issued.state, code: 'one', fetchImpl }),
    completeOAuth({ config, state: issued.state, code: 'two', fetchImpl })
  ]);
  assert.equal(results.filter(x => x.status === 'rejected').length, 2);
  assert.equal(exchanges, 1);
  const errorCodes = results.map(x => x.reason.code).sort();
  assert.deepEqual(errorCodes, ['OAUTH_EXCHANGE_FAILED', 'OAUTH_STATE_NOT_FOUND']);
});

test('expired OAuth state is consumed and cannot be replayed', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'etsy-oauth-expired-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const credential = path.join(dir, 'credentials.json');
  await fs.writeFile(credential, JSON.stringify({ client_id: 'example_key', secret: 'example_secret' }), { mode: 0o600 });
  const config = { default_shop: 'main', oauth_state_dir: path.join(dir, 'state'),
    shops: { main: { shop_id: '123', credential_file: credential } }, oauth_scopes: ['shops_r'] };
  const issued = await beginOAuth({ config, redirectUri: 'https://example.test/callback' });
  const filename = path.join(dir, 'state', issued.state + '.json');
  const record = JSON.parse(await fs.readFile(filename, 'utf8'));
  record.expires_at = Date.now() - 1;
  await fs.writeFile(filename, JSON.stringify(record), { mode: 0o600 });
  let exchanges = 0;
  const fetchImpl = async () => { exchanges++; return new Response('{}', { status: 200 }); };
  await assert.rejects(completeOAuth({ config, state: issued.state, code: 'somecode', fetchImpl }), /expired/);
  await assert.rejects(completeOAuth({ config, state: issued.state, code: 'somecode', fetchImpl }), /missing or already used/);
  assert.equal(exchanges, 0);
});

test('OAuth without explicit scopes defaults to minimum read-only access', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'etsy-oauth-scopes-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const credential = path.join(dir, 'creds.json');
  await fs.writeFile(credential, JSON.stringify({ client_id: 'example_key', secret: 'example_secret' }), { mode: 0o600 });
  const config = { default_shop: 'main', oauth_state_dir: path.join(dir, 'state'),
    shops: { main: { shop_id: '987', credential_file: credential } } };
  const issued = await beginOAuth({ config, redirectUri: 'https://example.test/callback' });
  assert.deepEqual(issued.scopes, ['shops_r', 'listings_r', 'transactions_r']);
  const url = new URL(issued.authorization_url);
  assert.equal(url.searchParams.get('scope'), 'shops_r listings_r transactions_r');
  assert.equal(url.searchParams.get('scope').includes('listings_w'), false);
});
