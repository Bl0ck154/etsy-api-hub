import fs from 'node:fs/promises';
import path from 'node:path';
import { inputError } from './errors.mjs';

export const DEFAULT_CONFIG_PATH = '/etc/etsy-api-hub/config.json';

export async function loadConfig(file = process.env.ETSY_HUB_CONFIG || DEFAULT_CONFIG_PATH) {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw inputError(`Etsy Hub config not found: ${file}. Set ETSY_HUB_CONFIG or create the file.`, 'CONFIG_NOT_FOUND');
    }
    throw error;
  }
  let config;
  try {
    config = JSON.parse(text);
  } catch {
    throw inputError(`Invalid JSON in Etsy Hub config: ${file}`, 'INVALID_CONFIG');
  }
  if (!config?.shops || typeof config.shops !== 'object' || Array.isArray(config.shops) || !Object.keys(config.shops).length) {
    throw inputError('config.shops must contain at least one shop', 'INVALID_CONFIG');
  }
  const defaultShop = config.default_shop || Object.keys(config.shops)[0];
  if (!config.shops[defaultShop]) throw inputError(`default_shop "${defaultShop}" is not configured`, 'INVALID_CONFIG');
  for (const [alias, shop] of Object.entries(config.shops)) {
    if (!/^\d+$/.test(String(shop?.shop_id || ''))) {
      throw inputError(`shops.${alias}.shop_id must be a positive numeric Etsy shop id`, 'INVALID_CONFIG');
    }
    if (!shop?.credential_file || !path.isAbsolute(shop.credential_file)) {
      throw inputError(`shops.${alias}.credential_file must be an absolute path`, 'INVALID_CONFIG');
    }
  }
  return {
    ...config,
    _path: file,
    default_shop: defaultShop,
    backup_dir: config.backup_dir || '/var/lib/etsy-api-hub/backups',
    audit_file: config.audit_file || '/var/log/etsy-api-hub/audit.jsonl',
    oauth_state_dir: config.oauth_state_dir || '/var/lib/etsy-api-hub/oauth-state',
    oauth_scopes: Array.isArray(config.oauth_scopes) ? config.oauth_scopes : null,
    server: {
      host: config.server?.host || '127.0.0.1',
      port: Number(config.server?.port || 3737),
      auth_token_file: config.server?.auth_token_file || null,
      public_base_url: config.server?.public_base_url || null,
    },
  };
}

export function publicConfig(config) {
  return {
    default_shop: config.default_shop,
    shops: Object.fromEntries(Object.entries(config.shops).map(([alias, shop]) => [
      alias,
      { shop_id: String(shop.shop_id) },
    ])),
    server: { host: config.server.host, port: config.server.port, auth_enabled: Boolean(config.server.auth_token_file) },
  };
}
