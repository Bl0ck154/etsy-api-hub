import { EtsyHub } from '../src/hub.mjs';
import { EtsyClient } from '../src/client.mjs';
import { EtsyMcpAdapter } from '../src/mcp-adapter.mjs';
import { ETSY_MCP_TOOLS } from '../src/mcp-tools.mjs';
import { buildGptOpenApi, gptRead, gptWrite } from '../src/gpt-adapter.mjs';

const enc = new TextEncoder();
const dec = new TextDecoder();
const noStore = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const b64 = bytes => { const b = new Uint8Array(bytes); let out = ''; for (let i=0;i<b.length;i+=8192) out += String.fromCharCode(...b.subarray(i,i+8192)); return btoa(out).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64 = s => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - String(s).length % 4) % 4)), c => c.charCodeAt(0));
const random = n => b64(crypto.getRandomValues(new Uint8Array(n)));
const escapeAttr = s => String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const now = () => Date.now();
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { ...noStore, 'content-type': 'application/json; charset=utf-8', ...headers } });
const html = (body, status = 200) => new Response(body, { status, headers: { ...noStore, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; form-action 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'", 'referrer-policy': 'no-referrer' } });
const redirect = url => new Response(null, { status: 302, headers: { location: url, ...noStore } });
const hash = async value => b64(await crypto.subtle.digest('SHA-256', enc.encode(value)));
const same = async (a, b) => {
  const x = await crypto.subtle.digest('SHA-256', enc.encode(String(a)));
  const y = await crypto.subtle.digest('SHA-256', enc.encode(String(b)));
  return new Uint8Array(x).every((v, i) => v === new Uint8Array(y)[i]);
};
const getBody = async (req, max = 6 * 1024 * 1024) => {
  if (Number(req.headers.get('content-length') || 0) > max) throw fail('BODY_TOO_LARGE', 413);
  const txt = await req.text();
  if (enc.encode(txt).byteLength > max) throw fail('BODY_TOO_LARGE', 413);
  try { return txt ? JSON.parse(txt) : {}; } catch { throw fail('INVALID_JSON'); }
};
const scope = 'etsy';
const scopes = ['listings_r','listings_w','listings_d','transactions_r','transactions_w','shops_r','shops_w','profile_r','profile_w','address_r','address_w','email_r'];
const readShops = env => {
  let shops;
  try { shops = JSON.parse(env.SHOPS_JSON || '{}'); } catch { throw fail('INVALID_SHOPS_CONFIG', 503); }
  if (!shops || Array.isArray(shops) || typeof shops !== 'object') throw fail('INVALID_SHOPS_CONFIG', 503);
  for (const [alias, cfg] of Object.entries(shops)) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(alias) || !/^[0-9]+$/.test(String(cfg?.shop_id || ''))) throw fail('INVALID_SHOPS_CONFIG', 503);
  }
  return shops;
};
const appFor = (env, alias) => {
  const apps = JSON.parse(env.ETSY_APPS_JSON || '{}');
  const credentials = apps[alias] || { client_id: env.ETSY_CLIENT_ID, secret: env.ETSY_CLIENT_SECRET };
  if (!credentials.client_id || !credentials.secret) throw fail('ETSY_APP_NOT_CONFIGURED', 503);
  return credentials;
};
const aesKey = async env => {
  const secret = env.TOKEN_ENCRYPTION_KEY || env.MCP_OWNER_PASSWORD;
  if (!secret || secret.length < 32) throw fail('OWNER_PASSWORD_NOT_CONFIGURED', 503);
  // Domain-separated keys. Rotating OWNER password without re-encryption invalidates stored credentials.
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('etsy-api-hub:token-encryption:v1:' + secret));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt','decrypt']);
};
async function seal(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(JSON.stringify(obj)));
  return 'v1.' + b64(iv) + '.' + b64(ciphertext);
}
async function unseal(env, value) {
  const [version, iv, ciphertext] = String(value).split('.');
  if (version !== 'v1' || !iv || !ciphertext) throw fail('INVALID_STORED_SECRET', 503);
  return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(env), unb64(ciphertext))));
}
class EdgeTokenStore {
  constructor(env, alias) { this.env = env; this.alias = alias; }
  async row() { return this.env.DB.prepare('SELECT sealed,lease_until FROM hub_tokens WHERE alias=?').bind(this.alias).first(); }
  async read() {
    const row = await this.row();
    if (!row) throw fail('SHOP_NOT_CONNECTED: ' + this.alias, 503);
    return unseal(this.env, row.sealed);
  }
  async apiKeyHeader() { const d = appFor(this.env, this.alias); return d.client_id + ':' + d.secret; }
  async accessToken() {
    const current = await this.read();
    return Number(current.expires_at || 0) > now() + 60000 ? current.access_token : this.refresh(current.access_token);
  }
  async refresh(stale) {
    const id = crypto.randomUUID();
    const db = this.env.DB;
    const deadline = now() + 15000;
    while (now() < deadline) {
      const current = await this.read();
      if (stale && current.access_token !== stale) return current.access_token;
      const take = await db.prepare('UPDATE hub_tokens SET lease_owner=?,lease_until=? WHERE alias=? AND lease_until<?').bind(id, now() + 120000, this.alias, now()).run();
      if (!take.meta.changes) { await new Promise(resolve => setTimeout(resolve, 300)); continue; }
      try {
        const fresh = await this.read();
        if (stale && fresh.access_token !== stale) return fresh.access_token;
        const app = appFor(this.env, this.alias);
        const res = await fetch('https://api.etsy.com/v3/public/oauth/token', {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-api-key': app.client_id + ':' + app.secret },
          body: new URLSearchParams({ grant_type: 'refresh_token', client_id: app.client_id, client_secret: app.secret, refresh_token: fresh.refresh_token }),
          signal: AbortSignal.timeout(20000)
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.access_token || !body.refresh_token) throw fail('ETSY_REFRESH_FAILED_' + res.status, 503);
        const next = { ...fresh, ...body, expires_at: now() + Number(body.expires_in || 3600) * 1000 };
        const saved = await db.prepare('UPDATE hub_tokens SET sealed=?,lease_owner=NULL,lease_until=0,updated_at=? WHERE alias=? AND lease_owner=?').bind(await seal(this.env, next), now(), this.alias, id).run();
        if (!saved.meta.changes) throw fail('REFRESH_LEASE_LOST', 503);
        return next.access_token;
      } finally {
        await db.prepare('UPDATE hub_tokens SET lease_owner=NULL,lease_until=0 WHERE alias=? AND lease_owner=?').bind(this.alias, id).run();
      }
    }
    throw fail('TOKEN_REFRESH_BUSY', 503);
  }
}
class EdgeHub extends EtsyHub {
  constructor(env) {
    const shops = readShops(env);
    super({ shops, default_shop: Object.keys(shops)[0] || 'main', audit_file: null, server: { host: 'cloudflare', port: 443, auth_token_file: null } });
    this.env = env;
  }
  client(alias) {
    const shop = this.shop(alias);
    if (!this.clients.has(shop.alias)) this.clients.set(shop.alias, new EtsyClient({ tokenStore: new EdgeTokenStore(this.env, shop.alias) }));
    return this.clients.get(shop.alias);
  }
  async audit({ shop, method, apiPath, status, operation, ok }) {
    await this.env.DB.prepare('INSERT INTO hub_audit (at,alias,method,path,status,operation,ok) VALUES (?,?,?,?,?,?,?)').bind(now(), shop.alias, method, apiPath, status ?? null, operation || null, ok ? 1 : 0).run();
  }
  async snapshotListing(listingId, { shop = null } = {}) {
    const cfg = this.shop(shop);
    const id = String(listingId);
    const [listing, inventory, personalization] = await Promise.all([
      this.getListing(id, { shop: cfg.alias }),
      this.request({ shop: cfg.alias, apiPath: '/application/listings/' + id + '/inventory' }),
      this.request({ shop: cfg.alias, apiPath: '/application/listings/' + id + '/personalization' })
    ]);
    const snapshot = { at: new Date().toISOString(), shop: cfg.alias, listing_id: id, listing: listing.data, inventory: inventory.data, personalization: personalization.data };
    const payload = await seal(this.env, snapshot);
    if (payload.length > 1200000) throw fail('SNAPSHOT_TOO_LARGE_NO_MUTATION', 413);
    const key = crypto.randomUUID();
    await this.env.DB.prepare('INSERT INTO hub_snapshots(id,alias,listing_id,at,sealed) VALUES(?,?,?,?,?)').bind(key, cfg.alias, id, now(), payload).run();
    return { data: { file: 'd1://hub_snapshots/' + key } };
  }
}
async function hmacKey(env) {
  const secret = env.MCP_SIGNING_KEY || env.MCP_OWNER_PASSWORD;
  if (!secret || secret.length < 32) throw fail('OWNER_PASSWORD_NOT_CONFIGURED', 503);
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('etsy-api-hub:mcp-signing:v1:' + secret));
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}
async function sign(env, obj) {
  const body = b64(enc.encode(JSON.stringify(obj)));
  const mac = b64(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(body)));
  return 'v1.' + body + '.' + mac;
}
async function verify(env, token, typ, resource) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const mac = b64(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(parts[1])));
  if (!(await same(mac, parts[2]))) return null;
  try {
    const obj = JSON.parse(dec.decode(unb64(parts[1])));
    return obj.typ === typ && obj.aud === resource && obj.sub === 'owner' && obj.exp > now() / 1000 && obj.iat <= now()/1000+60 ? obj : null;
  } catch { return null; }
}
async function issue(env, client, resource) {
  const at = Math.floor(now() / 1000);
  const refreshId = random(24);
  const core = { sub: 'owner', client_id: client, aud: resource, scope, iat: at };
  await env.DB.prepare('INSERT INTO mcp_refresh (jti,client_id,expires) VALUES (?,?,?)').bind(await hash(refreshId), client, (at + 86400*30)*1000).run();
  return {
    access_token: await sign(env, { ...core, typ: 'access', exp: at + 3600 }),
    refresh_token: await sign(env, { ...core, typ: 'refresh', jti: refreshId, exp: at + 86400*30 }),
    token_type: 'Bearer', expires_in: 3600, scope
  };
}
const authBearer = async (req, env) => {
  const got = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const owner = env.ADMIN_BEARER || env.MCP_OWNER_PASSWORD;
  return Boolean(owner && owner.length >= 32 && await same(got, owner));
};
async function authorized(req, env, resource) {
  if (await authBearer(req, env)) return true;
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return Boolean(token && (env.MCP_SIGNING_KEY || env.MCP_OWNER_PASSWORD) && await verify(env, token, 'access', resource));
}
const mcpWrite = name => /(_write|_create|_update|_delete|_set|_upload|_multipart)$/.test(name) || ['etsy_listing_create','etsy_inventory_set','etsy_personalization_set','etsy_request_write','etsy_request_multipart','etsy_variation_images_set','etsy_section_write','etsy_return_policy_write','etsy_processing_profile_write','etsy_shipping_profile_write','etsy_listing_property_write','etsy_listing_translation_write','etsy_holiday_preference_update'].includes(name);
async function oauth(req, env, url) {
  const origin = url.origin, resource = origin + '/mcp', path = url.pathname;
  if (path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp') return json({ resource, authorization_servers: [origin], scopes_supported: [scope] });
  if (path === '/.well-known/oauth-authorization-server' || path === '/.well-known/openid-configuration') return json({ issuer: origin, authorization_endpoint: origin + '/oauth/authorize', token_endpoint: origin + '/oauth/token', response_types_supported: ['code'], grant_types_supported: ['authorization_code','refresh_token'], token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'], scopes_supported: [scope], client_id_metadata_document_supported: true });
  if (path === '/oauth/authorize' && ['GET','POST'].includes(req.method)) {
    if (!env.MCP_OWNER_PASSWORD || env.MCP_OWNER_PASSWORD.length < 32) return json({ error: 'mcp_not_configured' }, 503);
    const q = req.method === 'GET' ? url.searchParams : new URLSearchParams(await req.text());
    const client = q.get('client_id') || '', target = q.get('redirect_uri') || '', challenge = q.get('code_challenge') || '', state = q.get('state') || '';
    let c, r;
    try { c = new URL(client); r = new URL(target); } catch { return json({ error: 'invalid_client' }, 400); }
    if (c.origin !== 'https://chatgpt.com' || !/^\/oauth\/[^/]+\/client\.json$/.test(c.pathname) || c.search || c.hash || r.origin !== 'https://chatgpt.com' || !r.pathname.startsWith('/connector/oauth/') || q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256' || q.get('resource') !== resource || challenge.length < 43 || (q.get('scope') || scope) !== scope) return json({ error: 'invalid_request' }, 400);
    const metaReq = await fetch(client, { signal: AbortSignal.timeout(5000), redirect: 'error' }).catch(() => null);
    const meta = metaReq?.ok ? await metaReq.json().catch(() => null) : null;
    if (!meta || meta.client_id !== client || meta.client_name !== 'ChatGPT' || !meta.redirect_uris?.includes(target)) return json({ error: 'unauthorized_client' }, 400);
    if (req.method === 'GET') return html('<!doctype html><html><head><meta charset="utf-8"><title>Etsy Hub Owner Login</title></head><body><h2>Connect Etsy Hub</h2><form method="post"><input type="hidden" name="client_id" value="' + escapeAttr(client) + '"><input type="hidden" name="redirect_uri" value="' + escapeAttr(target) + '"><input type="hidden" name="code_challenge" value="' + challenge + '"><input type="hidden" name="code_challenge_method" value="S256"><input type="hidden" name="response_type" value="code"><input type="hidden" name="resource" value="' + resource + '"><input type="hidden" name="state" value="' + escapeAttr(state) + '"><label>Owner password <input type="password" name="password" autocomplete="current-password" required></label><button type="submit">Connect</button></form></body></html>');
    const ip = req.headers.get('cf-connecting-ip') || 'unknown';
    const attempts = await env.DB.prepare('SELECT count,until FROM mcp_failures WHERE ip=?').bind(ip).first();
    if (attempts && attempts.count >= 5 && attempts.until > now()) return json({ error: 'too_many_attempts' }, 429);
    if (!(await same(q.get('password') || '', env.MCP_OWNER_PASSWORD))) {
      await env.DB.prepare('INSERT INTO mcp_failures(ip,count,until) VALUES(?,1,?) ON CONFLICT(ip) DO UPDATE SET count=CASE WHEN until<? THEN 1 ELSE count+1 END, until=?').bind(ip, now()+900000, now(), now()+900000).run();
      return html('<p>Incorrect password.</p>',401);
    }
    await env.DB.prepare('DELETE FROM mcp_failures WHERE ip=?').bind(ip).run();
    const existing = await env.DB.prepare('SELECT client_id FROM mcp_lock WHERE id=1').first();
    if (existing && existing.client_id !== client) return json({ error: 'unauthorized_client' }, 403);
    if (!existing) await env.DB.prepare('INSERT OR IGNORE INTO mcp_lock (id,client_id,at) VALUES(1,?,?)').bind(client, now()).run();
    const locked = await env.DB.prepare('SELECT client_id FROM mcp_lock WHERE id=1').first();
    if (locked?.client_id !== client) return json({error:'unauthorized_client'},403);
    const code = random(32);
    await env.DB.prepare('INSERT INTO mcp_codes(code,client_id,redirect_uri,challenge,resource,expires) VALUES(?,?,?,?,?,?)').bind(await hash(code), client, target, challenge, resource, now()+300000).run();
    const targetUrl = new URL(target); targetUrl.searchParams.set('code',code); if(state) targetUrl.searchParams.set('state',state);
    return redirect(targetUrl.toString());
  }
  if (path === '/oauth/token' && req.method === 'POST') {
    if (!env.MCP_SIGNING_KEY && !env.MCP_OWNER_PASSWORD) return json({ error: 'mcp_not_configured' }, 503);
    const q = new URLSearchParams(await req.text());
    const client = q.get('client_id') || '';
    const registered = await env.DB.prepare('SELECT client_id FROM mcp_lock WHERE id=1 AND client_id=?').bind(client).first();
    if (!registered) return json({ error: 'invalid_client' }, 401);
    if (q.get('grant_type') === 'authorization_code') {
      const codeHash = await hash(q.get('code') || '');
      const record = await env.DB.prepare('DELETE FROM mcp_codes WHERE code=? RETURNING *').bind(codeHash).first();
      if (!record || record.expires < now() || record.client_id !== client || record.redirect_uri !== q.get('redirect_uri') || record.resource !== (q.get('resource') || resource) || await hash(q.get('code_verifier') || '') !== record.challenge) return json({ error: 'invalid_grant' }, 400);
      return json(await issue(env, client, resource));
    }
    if (q.get('grant_type') === 'refresh_token') {
      const claims = await verify(env, q.get('refresh_token'), 'refresh', resource);
      if (!claims || claims.client_id !== client) return json({ error: 'invalid_grant' }, 400);
      const record = await env.DB.prepare('DELETE FROM mcp_refresh WHERE jti=? AND client_id=? AND expires>? RETURNING jti').bind(await hash(claims.jti), client, now()).first();
      if (!record) return json({ error: 'invalid_grant' }, 400);
      return json(await issue(env, client, resource));
    }
    return json({ error: 'unsupported_grant_type' }, 400);
  }
  return null;
}
async function beginEtsyAuthorization(env, url, alias) {
  const hub = new EdgeHub(env), cfg = hub.shop(alias), app = appFor(env, alias);
  if (await env.DB.prepare('SELECT alias FROM hub_tokens WHERE alias=?').bind(alias).first()) throw fail('shop_already_connected',409);
  const state = random(32), verifier = random(64), challenge = await hash(verifier);
  const redirectUri = url.origin + '/admin/oauth/callback';
  await env.DB.prepare('INSERT INTO hub_oauth(state,alias,verifier,redirect_uri,expires) VALUES(?,?,?,?,?)')
    .bind(await hash(state),alias,verifier,redirectUri,now()+900000).run();
  const etsy = new URL('https://www.etsy.com/oauth/connect');
  for (const [key,value] of Object.entries({response_type:'code',client_id:app.client_id,redirect_uri:redirectUri,scope:scopes.join(' '),state,code_challenge:challenge,code_challenge_method:'S256'})) etsy.searchParams.set(key,value);
  return {shop:alias,shop_id:String(cfg.shop_id),authorization_url:etsy.toString(),expires_in_seconds:900};
}
async function etsyConnect(req, env, url) {
  if (req.method === 'GET') {
    const aliases = Object.keys(readShops(env));
    const options = aliases.map(alias => '<option value="' + escapeAttr(alias) + '">' + escapeAttr(alias) + '</option>').join('');
    return html('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect Etsy shop</title><style>body{font:16px system-ui;max-width:440px;margin:3rem auto;padding:1rem;line-height:1.6}label{display:block;margin:1rem 0}input,select,button{box-sizing:border-box;width:100%;font:inherit;padding:.7rem}button{cursor:pointer}</style></head><body><h2>Connect Etsy shop</h2><p>Authorize your shop on Etsy. Your existing VPS session is not modified.</p>'+(!aliases.length?'<p>First configure SHOPS_JSON with the correct Etsy shop IDs in Cloudflare.</p>':'<form method="post" action="/admin/connect"><label>Shop<select name="shop" required>'+options+'</select></label><label>Owner password<input type="password" name="password" minlength="32" autocomplete="current-password" required></label><button>Continue to Etsy</button></form>')+'</body></html>');
  }
  if (req.method !== 'POST') return json({error:'method_not_allowed'},405);
  if (req.headers.get('origin') !== url.origin) return json({error:'invalid_origin'},403);
  if (Number(req.headers.get('content-length')||0)>4096) return json({error:'too_large'},413);
  const raw = await req.text();if(raw.length>4096)return json({error:'too_large'},413);
  const form = new URLSearchParams(raw);
  const ip = req.headers.get('cf-connecting-ip') || 'unknown';
  const record = await env.DB.prepare('SELECT count,until FROM mcp_failures WHERE ip=?').bind(ip).first();
  if (record && record.count>=5 && record.until>now()) return html('<p>Too many failed attempts.</p>',429);
  if (!env.MCP_OWNER_PASSWORD || env.MCP_OWNER_PASSWORD.length<32 || !(await same(form.get('password')||'',env.MCP_OWNER_PASSWORD))) {
    await env.DB.prepare('INSERT INTO mcp_failures(ip,count,until) VALUES(?,1,?) ON CONFLICT(ip) DO UPDATE SET count=CASE WHEN until<? THEN 1 ELSE count+1 END,until=?')
      .bind(ip,now()+900000,now(),now()+900000).run();
    return html('<p>Incorrect owner password or setup incomplete.</p>',401);
  }
  await env.DB.prepare('DELETE FROM mcp_failures WHERE ip=?').bind(ip).run();
  const requested = form.get('shop');
  if (!requested || !Object.prototype.hasOwnProperty.call(readShops(env),requested)) return json({error:'unknown_shop'},400);
  const data = await beginEtsyAuthorization(env,url,requested);
  return redirect(data.authorization_url);
}
async function etsyAdmin(req, env, url) {
  if (!await authBearer(req, env)) return json({error:'unauthorized'},401);
  if (url.pathname === '/admin/oauth/start' && req.method === 'POST') {
    const body = await getBody(req,4096);
    return json(await beginEtsyAuthorization(env,url,body.shop || new EdgeHub(env).config.default_shop));
  }
  if (url.pathname === '/admin/status' && req.method === 'GET') {
    const rows = await env.DB.prepare('SELECT alias,updated_at FROM hub_tokens ORDER BY alias').all();
    return json({shops:readShops(env),connected:rows.results});
  }
  return json({error:'not_found'},404);
}
async function etsyCallback(env, url) {
  const record = await env.DB.prepare('DELETE FROM hub_oauth WHERE state=? RETURNING *').bind(await hash(url.searchParams.get('state') || '')).first();
  if (!record || record.expires < now() || !url.searchParams.get('code')) return html('<p>Invalid or expired Etsy authorization.</p>',400);
  const hub = new EdgeHub(env), cfg = hub.shop(record.alias), app = appFor(env, record.alias);
  const res = await fetch('https://api.etsy.com/v3/public/oauth/token', { method:'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-api-key': app.client_id + ':' + app.secret }, body:new URLSearchParams({ grant_type:'authorization_code',client_id:app.client_id,client_secret:app.secret,code:url.searchParams.get('code'),code_verifier:record.verifier,redirect_uri:record.redirect_uri }) });
  const token = await res.json().catch(() => ({}));
  if (!res.ok || !token.access_token || !token.refresh_token) return html('<p>Etsy token exchange failed; start again.</p>',502);
  const headers = { 'x-api-key': app.client_id + ':' + app.secret, authorization:'Bearer ' + token.access_token };
  const meResp = await fetch('https://api.etsy.com/v3/application/users/me', {headers});
  const me = await meResp.json().catch(() => ({}));
  if (!meResp.ok || !me.user_id) return html('<p>Could not verify Etsy account ownership.</p>',502);
  const shopsResp = await fetch('https://api.etsy.com/v3/application/users/'+encodeURIComponent(me.user_id)+'/shops', {headers});
  const shops = await shopsResp.json().catch(() => ({}));
  if (!shopsResp.ok || !shops.results?.some(s => String(s.shop_id)===String(cfg.shop_id))) return html('<p>The authorized Etsy account does not own this shop.</p>',409);
  const value = await seal(env, { ...token, expires_at: now()+Number(token.expires_in||3600)*1000, user_id:String(me.user_id) });
  const result = await env.DB.prepare('INSERT OR IGNORE INTO hub_tokens(alias,sealed,lease_owner,lease_until,updated_at) VALUES(?,?,NULL,0,?)').bind(record.alias,value,now()).run();
  if (!result.meta.changes) return html('<p>Shop already connected; existing tokens preserved.</p>',409);
  return html('<h2>Etsy shop connected</h2><p>Authorization saved securely. You can close this page.</p>');
}
export default {
  async fetch(req, env) {
    try {
      const url = new URL(req.url), path = url.pathname, origin = url.origin;
      if (path === '/health') {
        const shops = readShops(env);
        return json({ ok: true, service: 'etsy-api-hub-cloudflare', account: 'malinary-art', configured_shops: Object.keys(shops).length, oauth_ready: Boolean(env.MCP_OWNER_PASSWORD && env.MCP_OWNER_PASSWORD.length >= 32), etsy_ready: Boolean((env.TOKEN_ENCRYPTION_KEY || env.MCP_OWNER_PASSWORD) && (env.ETSY_APPS_JSON || env.ETSY_CLIENT_ID)) });
      }
      if (path.startsWith('/.well-known/') || path === '/oauth/authorize' || path === '/oauth/token') {
        const resp = await oauth(req, env, url); if (resp) return resp;
      }
      if (path === '/gpt/openapi.json' && req.method === 'GET') return json(buildGptOpenApi({publicBaseUrl:origin}));
      if (path === '/admin/oauth/callback' && req.method === 'GET') return etsyCallback(env,url);
      if (path === '/admin/connect') return etsyConnect(req,env,url);
      if (path.startsWith('/admin/')) return etsyAdmin(req,env,url);
      if (path === '/mcp' && req.method === 'POST') {
        if (!await authorized(req,env,origin+'/mcp')) return json({ error: 'oauth_required' },401,{ 'www-authenticate': 'Bearer resource_metadata="' + origin + '/.well-known/oauth-protected-resource"' });
        const body = await getBody(req), method = body.method, id = body.id ?? null;
        if (body.jsonrpc !== '2.0' || !method) return json({jsonrpc:'2.0',id,error:{code:-32600,message:'Invalid Request'}},400);
        const modern = req.headers.get('mcp-protocol-version') === '2026-07-28' || method === 'server/discover';
        const reply = value => json({jsonrpc:'2.0',id,result:modern?{resultType:'complete',...value}:value});
        if (method === 'server/discover') return reply({ supportedVersions:['2026-07-28'],capabilities:{tools:{}},_meta:{'io.modelcontextprotocol/serverInfo':{name:'etsy-shop-manager',version:'1.1.0'}},ttlMs:300000,cacheScope:'private'});
        if (method === 'initialize') return reply({protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'etsy-shop-manager',version:'1.1.0'}});
        if (method === 'ping') return reply({});
        if (method === 'tools/list') return reply({tools:ETSY_MCP_TOOLS,ttlMs:300000,cacheScope:'private'});
        if (method === 'tools/call') {
          const name = body.params?.name || '', args = body.params?.arguments || {};
          if (!ETSY_MCP_TOOLS.some(tool => tool.name === name)) return json({jsonrpc:'2.0',id,error:{code:-32601,message:'Unknown tool'}},400);
          if (mcpWrite(name) && env.ENABLE_WRITES !== 'true') return reply({content:[{type:'text',text:'Writes disabled during Cloudflare migration.'}],isError:true});
          try {
            const hub = new EdgeHub(env);
            const value = await new EtsyMcpAdapter(hub, hub.config).call(name,args);
            return reply({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value});
          } catch (err) {
            return reply({content:[{type:'text',text:JSON.stringify({ok:false,error:err.message})}],isError:true});
          }
        }
        return json({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}},400);
      }
      if ((path === '/gpt/read' || path === '/gpt/write') && req.method === 'POST') {
        if (!await authBearer(req,env)) return json({error:'unauthorized'},401);
        if (path === '/gpt/write' && env.ENABLE_WRITES !== 'true') return json({error:'writes_disabled'},403);
        const data = await (path === '/gpt/read' ? gptRead : gptWrite)(new EdgeHub(env),await getBody(req));
        return json({ok:true,data:data.data,meta:data.meta});
      }
      return json({error:'not_found'},404);
    } catch (e) {
      const msg = e?.message || 'internal_error';
      return json({ok:false,error:msg.startsWith('ETSY_') ? msg : msg, status:e?.status||500},e?.status||500);
    }
  }
};
