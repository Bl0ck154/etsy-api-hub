import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { EtsyHubError, inputError } from './errors.mjs';

const AUTHORIZE_URL = 'https://www.etsy.com/oauth/connect';
const TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token';
const API_BASE = 'https://api.etsy.com/v3/application';
const DEFAULT_STATE_TTL_MS = 15 * 60 * 1000;

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

async function readCredentialShell(file) {
  let data;
  try {
    data = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') throw inputError(`Credential file not found: ${file}`, 'CREDENTIAL_FILE_NOT_FOUND');
    if (error instanceof SyntaxError) throw inputError(`Credential file is not valid JSON: ${file}`, 'INVALID_CREDENTIAL_FILE');
    throw error;
  }
  const clientId = String(data.client_id || data.api_key || '').trim();
  const secret = String(data.secret || data.shared_secret || '').trim();
  if (!clientId || !secret) {
    throw inputError(`Credential file ${file} must contain client_id/api_key and secret`, 'INVALID_CREDENTIAL_FILE');
  }
  return { data, clientId, secret };
}

async function atomicWriteJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await fs.chmod(tmp, 0o600);
  await fs.rename(tmp, file);
  await fs.chmod(file, 0o600);
}

function stateDir(config) {
  return config.oauth_state_dir || '/var/lib/etsy-api-hub/oauth-state';
}

function stateFile(config, state) {
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(String(state || ''))) {
    throw inputError('Invalid OAuth state', 'INVALID_OAUTH_STATE');
  }
  return path.join(stateDir(config), `${state}.json`);
}

function normalizeScopes(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || '').split(/[\s,]+/);
  const scopes = [...new Set(raw.map(item => String(item).trim()).filter(Boolean))];
  if (!scopes.length) throw inputError('At least one Etsy OAuth scope is required', 'OAUTH_SCOPES_REQUIRED');
  for (const scope of scopes) {
    if (!/^[a-z][a-z0-9_]*$/.test(scope)) throw inputError(`Invalid OAuth scope: ${scope}`, 'INVALID_OAUTH_SCOPE');
  }
  return scopes;
}

export async function beginOAuth({ config, shopAlias, redirectUri, scopes } = {}) {
  const shop = config?.shops?.[shopAlias || config?.default_shop];
  const alias = shopAlias || config?.default_shop;
  if (!shop) throw inputError(`Unknown shop alias: ${alias}`, 'UNKNOWN_SHOP');
  if (!/^https:\/\//i.test(String(redirectUri || ''))) {
    throw inputError('redirect_uri must be an HTTPS URL registered in the Etsy app', 'INVALID_REDIRECT_URI');
  }

  const { clientId } = await readCredentialShell(shop.credential_file);
  const requestedScopes = normalizeScopes(scopes || config.oauth_scopes || [
    'listings_r', 'listings_w', 'listings_d',
    'transactions_r', 'transactions_w',
    'shops_r', 'shops_w',
    'profile_r', 'profile_w',
    'address_r', 'address_w', 'email_r',
  ]);

  const state = b64url(crypto.randomBytes(32));
  const verifier = b64url(crypto.randomBytes(64));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const createdAt = Date.now();
  const record = {
    version: 1,
    state,
    shop: alias,
    expected_shop_id: String(shop.shop_id),
    verifier,
    redirect_uri: String(redirectUri),
    scopes: requestedScopes,
    created_at: createdAt,
    expires_at: createdAt + DEFAULT_STATE_TTL_MS,
  };
  await atomicWriteJson(stateFile(config, state), record);

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', String(redirectUri));
  url.searchParams.set('scope', requestedScopes.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');

  return {
    shop: alias,
    expected_shop_id: String(shop.shop_id),
    authorization_url: url.toString(),
    state,
    expires_at: new Date(record.expires_at).toISOString(),
    scopes: requestedScopes,
  };
}

async function exchangeCode({ clientId, secret, code, verifier, redirectUri, fetchImpl }) {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-api-key': `${clientId}:${secret}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: secret,
      code: String(code),
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok || !data?.access_token || !data?.refresh_token) {
    throw new EtsyHubError(data?.error_description || data?.error || `Etsy OAuth exchange failed with HTTP ${response.status}`, {
      code: 'OAUTH_EXCHANGE_FAILED',
      status: response.status || 502,
      details: { status: response.status },
    });
  }
  return data;
}

async function resolveAuthorizedShop({ accessToken, clientId, secret, fetchImpl }) {
  const headers = {
    'x-api-key': `${clientId}:${secret}`,
    Authorization: `Bearer ${accessToken}`,
  };
  const meResponse = await fetchImpl(`${API_BASE}/users/me`, { headers });
  const me = await meResponse.json();
  if (!meResponse.ok || !me?.user_id) {
    throw new EtsyHubError('OAuth succeeded but Etsy user lookup failed', {
      code: 'OAUTH_USER_LOOKUP_FAILED',
      status: meResponse.status || 502,
    });
  }
  const shopsResponse = await fetchImpl(`${API_BASE}/users/${encodeURIComponent(me.user_id)}/shops`, { headers });
  const shops = await shopsResponse.json();
  if (!shopsResponse.ok) {
    throw new EtsyHubError('OAuth succeeded but Etsy shop lookup failed', {
      code: 'OAUTH_SHOP_LOOKUP_FAILED',
      status: shopsResponse.status || 502,
    });
  }
  const values = Array.isArray(shops?.results) ? shops.results : [];
  return {
    user_id: String(me.user_id),
    shop_ids: values.map(item => String(item?.shop_id || '')).filter(Boolean),
  };
}

export async function completeOAuth({ config, state, code, fetchImpl = fetch } = {}) {
  if (!code) throw inputError('OAuth code is required', 'OAUTH_CODE_REQUIRED');
  const file = stateFile(config, state);
  let record;
  try {
    record = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') throw inputError('OAuth state is missing or already used', 'OAUTH_STATE_NOT_FOUND');
    throw error;
  }
  if (record.state !== state || Date.now() > Number(record.expires_at || 0)) {
    try { await fs.unlink(file); } catch {}
    throw inputError('OAuth state expired or did not match', 'OAUTH_STATE_EXPIRED');
  }

  const shop = config?.shops?.[record.shop];
  if (!shop) throw inputError(`Unknown shop alias in OAuth state: ${record.shop}`, 'UNKNOWN_SHOP');
  const { data: existing, clientId, secret } = await readCredentialShell(shop.credential_file);
  const token = await exchangeCode({
    clientId,
    secret,
    code,
    verifier: record.verifier,
    redirectUri: record.redirect_uri,
    fetchImpl,
  });
  const resolved = await resolveAuthorizedShop({
    accessToken: token.access_token,
    clientId,
    secret,
    fetchImpl,
  });

  if (!resolved.shop_ids.includes(String(shop.shop_id))) {
    throw new EtsyHubError(
      `Authorized Etsy account does not own configured shop ${shop.shop_id}`,
      {
        code: 'OAUTH_WRONG_SHOP',
        status: 409,
        details: { expected_shop_id: String(shop.shop_id), authorized_shop_ids: resolved.shop_ids },
      },
    );
  }

  const now = Date.now();
  const next = {
    ...existing,
    client_id: clientId,
    secret,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    token_type: token.token_type || 'Bearer',
    expires_in: Number(token.expires_in || 3600),
    expires_at: now + Number(token.expires_in || 3600) * 1000,
    scope: token.scope || record.scopes.join(' '),
    user_id: resolved.user_id,
    authorized_at: new Date(now).toISOString(),
    refreshed_at: new Date(now).toISOString(),
  };
  await atomicWriteJson(shop.credential_file, next);
  try { await fs.unlink(file); } catch {}

  return {
    connected: true,
    shop: record.shop,
    shop_id: String(shop.shop_id),
    user_id: resolved.user_id,
    expires_at: new Date(next.expires_at).toISOString(),
    scope: next.scope,
  };
}
