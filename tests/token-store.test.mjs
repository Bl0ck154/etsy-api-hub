import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { TokenFileStore } from '../src/token-store.mjs';

test('refresh uses shared secret header and persists rotated token pair', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'etsy-hub-token-'));
  const file = path.join(dir, 'token.json');
  await fs.writeFile(file, JSON.stringify({
    client_id: 'key123',
    secret: 'secret456',
    access_token: 'old-access',
    refresh_token: 'old-refresh',
    expires_at: Date.now() - 1000,
  }));

  let seen = null;
  const fetchImpl = async (url, options) => {
    seen = { url, options };
    return new Response(JSON.stringify({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'listings_r listings_w',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const store = new TokenFileStore(file, { fetchImpl });
  assert.equal(await store.accessToken(), 'new-access');
  assert.equal(seen.options.headers['x-api-key'], 'key123:secret456');
  const form = new URLSearchParams(String(seen.options.body));
  assert.equal(form.get('client_id'), 'key123');
  assert.equal(form.get('client_secret'), 'secret456');
  assert.equal(form.get('refresh_token'), 'old-refresh');

  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(saved.access_token, 'new-access');
  assert.equal(saved.refresh_token, 'new-refresh');
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});
