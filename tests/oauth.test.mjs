import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { beginOAuth } from '../src/oauth.mjs';

test('beginOAuth creates bounded PKCE state and Etsy authorization URL', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'etsy-hub-oauth-'));
  const credential = path.join(dir, 'main.json');
  const stateDir = path.join(dir, 'state');
  await fs.writeFile(credential, JSON.stringify({ client_id: 'key123', secret: 'secret456' }));

  const config = {
    default_shop: 'main',
    oauth_state_dir: stateDir,
    shops: { main: { shop_id: '23207964', credential_file: credential } },
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
  assert.equal(state.expected_shop_id, '23207964');
  assert.ok(state.verifier);
  assert.equal((await fs.stat(path.join(stateDir, result.state + '.json'))).mode & 0o777, 0o600);
});
