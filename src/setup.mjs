import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from './config.mjs';

export function localConfigPath(home = os.homedir()) {
  return path.join(home, '.config', 'etsy-seller-mcp-hub', 'config.json');
}

async function createPrivateJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(data, null, 2) + '\n'); }
  finally { await handle.close(); }
}

export async function initLocalSetup({ shopId, configPath = localConfigPath(), credentialPath } = {}) {
  if (!/^[1-9]\d*$/.test(String(shopId || ''))) throw new Error('Provide your numeric Etsy shop ID with --shop-id');
  const target = path.resolve(configPath);
  const credentials = credentialPath ? path.resolve(credentialPath) : path.join(path.dirname(target), 'credentials.json');
  if (target === credentials) throw new Error('Config and credentials paths must differ');
  for (const file of [target, credentials]) {
    try { await fs.lstat(file); throw new Error('File already exists; refusing to overwrite: ' + file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const base = path.dirname(target);
  await createPrivateJson(target, {
    default_shop: 'main',
    backup_dir: path.join(base, 'backups'),
    audit_file: path.join(base, 'audit.jsonl'),
    oauth_state_dir: path.join(base, 'oauth-state'),
    oauth_scopes: ['shops_r', 'listings_r', 'transactions_r'],
    shops: { main: { shop_id: String(shopId), credential_file: credentials } },
    server: { host: '127.0.0.1', port: 3737 }
  });
  try {
    await createPrivateJson(credentials, { client_id: '', secret: '', access_token: '', refresh_token: '' });
  } catch (error) {
    // Do not leave a configuration pointing to a missing credential file.
    // This path was created with 'wx' above; best effort rollback.
    try { await fs.unlink(target); } catch {}
    throw error;
  }
  return {
    config_file: target, credentials_file: credentials,
    next_steps: [
      'Edit your local credential file and add the Etsy keystring and shared secret (never paste them into command arguments).',
      'Run etsyctl doctor to check setup offline.',
      'Use etsyctl oauth start --redirect https://your-registered-callback.example/callback, then oauth complete.',
      'Run ETSY_MCP_READ_ONLY=1 etsy-mcp'
    ]
  };
}

export async function diagnoseLocalSetup({ configPath } = {}) {
  const checks = [];
  const check = (name, status, detail) => checks.push({ name, status, detail });
  check('node', Number(process.versions.node.split('.')[0]) >= 22 ? 'pass' : 'fail', 'Node.js 22+ required');
  let config;
  try {
    config = await loadConfig(configPath);
    check('config', 'pass', 'Shop configurations: ' + Object.keys(config.shops).length);
  } catch (error) {
    check('config', 'fail', error.code || 'Invalid or missing config');
    return { ok: false, ready: false, checks };
  }
  for (const [alias, shop] of Object.entries(config.shops)) {
    let data;
    try {
      const stat = await fs.lstat(shop.credential_file);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        check('credentials:' + alias, 'fail', 'Credentials must be a regular file, not a symlink');
        continue;
      }
      if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) check('permissions:' + alias, 'warn', 'Restrict credential file to 0600');
      else check('permissions:' + alias, 'pass', 'Credential file access restricted');
      data = JSON.parse(await fs.readFile(shop.credential_file, 'utf8'));
    } catch (error) {
      check('credentials:' + alias, 'fail', error.code === 'ENOENT' ? 'Credential file missing' : 'Unreadable/invalid credential JSON');
      continue;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      check('credentials:' + alias, 'fail', 'Credential JSON must be an object');
      continue;
    }
    if (!(data.client_id || data.api_key) || !(data.secret || data.shared_secret)) {
      check('api_key:' + alias, 'fail', 'Add your Etsy v3 keystring and shared secret to the local file');
    } else {
      check('api_key:' + alias, 'pass', 'API fields present (offline check, not verified by Etsy)');
      check('oauth:' + alias, data.access_token && data.refresh_token ? 'pass' : 'warn',
        data.access_token && data.refresh_token ? 'OAuth fields present (offline)' : 'Authorize your shop with oauth start/complete');
    }
  }
  return { ok: !checks.some(c => c.status === 'fail'), ready: checks.every(c => c.status === 'pass'), checks };
}
