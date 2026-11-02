import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { EtsyMcpOAuth } from '../src/mcp-oauth.mjs';

async function makeFixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'etsy-mcp-rotation-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const old = process.env.MCP_OWNER_PASSWORD_HASH_FILE;
  const passwordFile = path.join(root, 'dummy-password.json');
  await fsp.writeFile(passwordFile, JSON.stringify({
    version: 1, algorithm: 'scrypt', salt: '00112233445566778899aabbccddeeff',
    hash: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
    n: 16384, r: 8, p: 1,
  }), { mode: 0o600 });
  process.env.MCP_OWNER_PASSWORD_HASH_FILE = passwordFile;
  t.after(() => {
    if (old === undefined) delete process.env.MCP_OWNER_PASSWORD_HASH_FILE;
    else process.env.MCP_OWNER_PASSWORD_HASH_FILE = old;
  });
  const stateDir = path.join(root, 'states');
  const oauth = new EtsyMcpOAuth('test-mcp-secret-private', stateDir);
  const client = 'https://chatgpt.com/oauth/test/client.json';
  await fsp.writeFile(path.join(stateDir, 'mcp-chatgpt-client.json'),
    JSON.stringify({ client_id: client }), { mode: 0o600 });
  return { root, stateDir, oauth, client };
}

async function refresh(oauth, client, token) {
  const base = 'https://etsy-bridge.example.test';
  const form = new URLSearchParams({
    grant_type: 'refresh_token', client_id: client, resource: base + '/mcp', refresh_token: token,
  }).toString();
  const req = Object.assign(Readable.from([Buffer.from(form)]), {
    method: 'POST', headers: {}, socket: { remoteAddress: '127.0.0.1' },
  });
  const response = {
    status: 0, headers: {},
    writeHead(code, headers) { this.status = code; this.headers = headers; },
    end(body) { this.body = JSON.parse(String(body)); },
  };
  assert.equal(await oauth.handle(req, response, new URL(base + '/oauth/token'), base), true);
  return { status: response.status, body: response.body };
}

test('remote refresh tokens rotate once; replay fails after restart', async t => {
  const { oauth, client, stateDir } = await makeFixture(t);
  const original = oauth.issueTokens(client, 'https://etsy-bridge.example.test/mcp');
  const first = await refresh(oauth, client, original.refresh_token);
  assert.equal(first.status, 200);
  assert.notEqual(first.body.refresh_token, original.refresh_token);
  const replay = await refresh(oauth, client, original.refresh_token);
  assert.deepEqual(replay, { status: 400, body: { error: 'invalid_grant' } });
  const restarted = new EtsyMcpOAuth('test-mcp-secret-private', stateDir);
  const stillRejected = await refresh(restarted, client, original.refresh_token);
  assert.equal(stillRejected.status, 400);
  const second = await refresh(restarted, client, first.body.refresh_token);
  assert.equal(second.status, 200);
  assert.equal((await fsp.readdir(path.join(stateDir, 'mcp-used-refresh'))).length, 2);
  if (process.platform !== 'win32') assert.equal((await fsp.stat(path.join(stateDir, 'mcp-used-refresh',
    crypto.createHash('sha256').update(original.refresh_token).digest('hex') + '.used'))).mode & 0o077, 0);
});

test('two concurrent attempts to refresh the same token authorize only one', async t => {
  const { oauth, client } = await makeFixture(t);
  const issued = oauth.issueTokens(client, 'https://etsy-bridge.example.test/mcp');
  const results = await Promise.all([
    refresh(oauth, client, issued.refresh_token),
    refresh(oauth, client, issued.refresh_token),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
});

test('wrong audience, invalid signature and expired refresh token never rotate', async t => {
  const { oauth, client, stateDir } = await makeFixture(t);
  const resource = 'https://etsy-bridge.example.test/mcp';
  const issued = oauth.issueTokens(client, resource);
  const wrong = await refresh(oauth, client, oauth.signToken({
    typ: 'refresh', sub: 'owner', client_id: client, aud: 'https://other.example/mcp',
    scope: 'etsy', exp: Math.floor(Date.now()/1000) + 600, iat: Math.floor(Date.now()/1000), jti: crypto.randomUUID(),
  }));
  assert.equal(wrong.status, 400);
  const expired = await refresh(oauth, client, oauth.signToken({
    typ: 'refresh', sub: 'owner', client_id: client, aud: resource, scope: 'etsy',
    exp: Math.floor(Date.now()/1000) - 1, iat: Math.floor(Date.now()/1000) - 3600, jti: crypto.randomUUID(),
  }));
  assert.equal(expired.status, 400);
  const invalid = await refresh(oauth, client, issued.refresh_token + '-altered');
  assert.equal(invalid.status, 400);
  assert.deepEqual(await fsp.readdir(path.join(stateDir, 'mcp-used-refresh')), []);
});

test('old spent-token fingerprints are pruned, current ones remain', async t => {
  const { oauth, client, stateDir } = await makeFixture(t);
  const issued = oauth.issueTokens(client, 'https://etsy-bridge.example.test/mcp');
  await refresh(oauth, client, issued.refresh_token);
  const dir = path.join(stateDir, 'mcp-used-refresh');
  const current = (await fsp.readdir(dir))[0];
  const expired = path.join(dir, 'a'.repeat(64) + '.used');
  await fsp.writeFile(expired, 'expired');
  const old = new Date(Date.now() - 95 * 86400 * 1000);
  await fsp.utimes(expired, old, old);
  new EtsyMcpOAuth('test-mcp-secret-private', stateDir);
  assert.deepEqual(await fsp.readdir(dir), [current]);
});
