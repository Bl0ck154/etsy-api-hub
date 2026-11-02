import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { initLocalSetup, diagnoseLocalSetup, localConfigPath } from '../src/setup.mjs';
import { loadConfig } from '../src/config.mjs';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'etsy-public-setup-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return { dir, configPath: path.join(dir, 'config.json') };
}
test('init creates portable local config and private credential placeholder without secrets', async t => {
  const f = await fixture(t);
  const result = await initLocalSetup({ shopId: '12345678', configPath: f.configPath });
  const config = JSON.parse(await fs.readFile(result.config_file, 'utf8'));
  const creds = JSON.parse(await fs.readFile(result.credentials_file, 'utf8'));
  assert.equal(config.shops.main.shop_id, '12345678');
  assert.deepEqual(config.oauth_scopes, ['shops_r', 'listings_r', 'transactions_r']);
  assert.equal(creds.client_id, '');
  assert.equal(creds.secret, '');
  assert.equal((await fs.stat(result.credentials_file)).mode & 0o077, 0);
  assert.equal((await fs.stat(result.config_file)).mode & 0o077, 0);
  assert.equal((await loadConfig(f.configPath)).default_shop, 'main');
});
test('init refuses to replace credential files or config files', async t => {
  const f = await fixture(t);
  const protectedFile = path.join(f.dir, 'credentials.json');
  await fs.writeFile(protectedFile, 'do-not-change', { mode: 0o600 });
  await assert.rejects(initLocalSetup({ shopId: '123', configPath: f.configPath }), /already exists/);
  assert.equal(await fs.readFile(protectedFile, 'utf8'), 'do-not-change');
  await fs.rm(protectedFile);
  await initLocalSetup({ shopId: '123', configPath: f.configPath });
  await assert.rejects(initLocalSetup({ shopId: '123', configPath: f.configPath }), /already exists/);
});
test('init rejects invalid shop IDs and overlapping credentials path', async t => {
  const f = await fixture(t);
  for (const shopId of ['', '0', '-1', '1; rm -rf /', '1.0', '../2']) {
    await assert.rejects(initLocalSetup({ shopId, configPath: f.configPath }), /numeric Etsy shop ID/);
  }
  await assert.rejects(initLocalSetup({ shopId: '1', configPath: f.configPath, credentialPath: f.configPath }), /must differ/);
});
test('doctor redacts secret data and reports incomplete authorization without network', async t => {
  const f = await fixture(t);
  const result = await initLocalSetup({ shopId: '987', configPath: f.configPath });
  let d = await diagnoseLocalSetup({ configPath: f.configPath });
  assert.equal(d.ok, false);
  assert(d.checks.some(c => c.name === 'api_key:main' && c.status === 'fail'));
  const sentinel = 'secret-canary-value-never-output-638726';
  const creds = { client_id: sentinel, secret: sentinel, access_token: '', refresh_token: '' };
  await fs.writeFile(result.credentials_file, JSON.stringify(creds), { mode: 0o600 });
  d = await diagnoseLocalSetup({ configPath: f.configPath });
  assert.equal(d.ok, true);
  assert.equal(d.ready, false);
  assert(d.checks.some(c => c.name === 'oauth:main' && c.status === 'warn'));
  assert.equal(JSON.stringify(d).includes(sentinel), false);
  await fs.writeFile(result.credentials_file, JSON.stringify({ ...creds, access_token: sentinel, refresh_token: sentinel }));
  d = await diagnoseLocalSetup({ configPath: f.configPath });
  assert.equal(d.ready, true);
  assert.equal(JSON.stringify(d).includes(sentinel), false);
});
test('doctor rejects symlink credential files and detects overly broad file permissions', async t => {
  const f = await fixture(t);
  const result = await initLocalSetup({ shopId: '987', configPath: f.configPath });
  await fs.writeFile(result.credentials_file, JSON.stringify({ client_id: 'a', secret: 'b', access_token: 'c', refresh_token: 'd' }));
  await fs.chmod(result.credentials_file, 0o644);
  let d = await diagnoseLocalSetup({ configPath: f.configPath });
  assert.equal(d.ready, false);
  assert(d.checks.some(c => c.name === 'permissions:main' && c.status === 'warn'));
  const otherFile = path.join(f.dir, 'private.json');
  await fs.rename(result.credentials_file, otherFile);
  await fs.symlink(otherFile, result.credentials_file);
  d = await diagnoseLocalSetup({ configPath: f.configPath });
  assert.equal(d.ok, false);
  assert(d.checks.some(c => c.name === 'credentials:main' && c.status === 'fail'));
});
test('doctor handles invalid and missing JSON without leaking file content', async t => {
  const f = await fixture(t);
  let d = await diagnoseLocalSetup({ configPath: f.configPath });
  assert.equal(d.ok, false);
  await fs.writeFile(f.configPath, '{"access_token":"secret-canary"!}');
  d = await diagnoseLocalSetup({ configPath: f.configPath });
  assert.equal(d.ok, false);
  assert.equal(JSON.stringify(d).includes('secret-canary'), false);
});
test('CLI help works without credentials and supports both help switches', async () => {
  const cli = new URL('../bin/etsyctl.mjs', import.meta.url).pathname;
  for (const flag of ['--help', '-h', 'help']) {
    const p = spawnSync(process.execPath, [cli, flag], { encoding: 'utf8', env: { ...process.env, ETSY_HUB_CONFIG: '/nonexistent/etsy-config.json' } });
    assert.equal(p.status, 0, p.stderr);
    assert.match(p.stdout, /etsyctl init/);
    assert.equal(p.stderr, '');
  }
});
test('local config location uses user home, not a hardcoded server path', () => {
  assert.equal(localConfigPath('/home/example'), '/home/example/.config/etsy-seller-mcp-hub/config.json');
});

test('MCP stdio can introspect with a synthetic config and without Etsy credentials', async () => {
  const cli = new URL('../bin/etsy-mcp.mjs', import.meta.url).pathname;
  const config = new URL('../config.example.json', import.meta.url).pathname;
  const response = spawnSync(process.execPath, [cli], {
    env: { ...process.env, ETSY_HUB_CONFIG: config, ETSY_MCP_READ_ONLY: '1' },
    input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n'
      + JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n',
    encoding: 'utf8', timeout: 9000
  });
  assert.equal(response.status, 0, response.stderr);
  const messages = response.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(messages[0].result.serverInfo.version, '0.4.1');
  assert.equal(messages[1].result.tools.length, 53);
  assert.equal(response.stderr, '');
});

test('init rolls back newly created config if credential creation fails', async t => {
  const f = await fixture(t);
  const parent = path.join(f.dir, 'occupied');
  await fs.writeFile(parent, 'not-a-directory', { mode: 0o600 });
  await assert.rejects(initLocalSetup({
    shopId: '77', configPath: f.configPath, credentialPath: path.join(parent, 'secret.json')
  }), /ENOTDIR|EEXIST/);
  await assert.rejects(fs.stat(f.configPath), { code: 'ENOENT' });
});
test('doctor treats credentials that contain JSON arrays as invalid', async t => {
  const f = await fixture(t);
  const paths = await initLocalSetup({ shopId: '120', configPath: f.configPath });
  await fs.writeFile(paths.credentials_file, JSON.stringify([{ client_id: 'a', secret: 'b' }]));
  const d = await diagnoseLocalSetup({ configPath: f.configPath });
  assert.equal(d.ok, false);
  assert(d.checks.some(x => x.name === 'credentials:main' && x.status === 'fail'));
});
