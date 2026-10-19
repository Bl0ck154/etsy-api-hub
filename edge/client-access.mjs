// Scoped, revocable service credentials. No Etsy OAuth credentials or raw service tokens in D1.
import { normalizeApiPath } from '../src/client.mjs';

const bytes = new TextEncoder();
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.encode(value))), b => b.toString(16).padStart(2, '0')).join('');
const key = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join('');
const fault = (message, status = 403) => Object.assign(new Error(message), { status });
const permissions = new Set(['read', 'write', 'media']);
const verbs = new Set(['GET','POST','PUT','PATCH','DELETE']);

const safePathPrefix = value => {
  const s = String(value || '').trim().replace(/\/+$/, '');
  if (!s.startsWith('/application/') || s.includes('..') || /[%?#]/.test(s) || s.length > 180) throw fault('Invalid Etsy path restriction', 400);
  return s;
};
const parseJson = text => { try { return JSON.parse(text); } catch { return null; } };
const aliases = env => Object.keys(parseJson(env.SHOPS_JSON || '{}') || {});
const readonlyDetails = row => ({
  id: row.id, name: row.name,
  scopes: parseJson(row.scopes) || [],
  shops: parseJson(row.shops) || [],
  path_prefixes: parseJson(row.path_prefixes) || [],
  created_at: row.created_at,
  revoked_at: row.revoked_at,
  last_used_at: row.last_used_at
});

export async function listServiceClients(env) {
  const rows = await env.DB.prepare('SELECT id,name,scopes,shops,path_prefixes,created_at,revoked_at,last_used_at FROM hub_clients ORDER BY created_at DESC LIMIT 100').all();
  return (rows.results || []).map(readonlyDetails);
}

// An owner-initiated action; returns raw token exactly once, never persist/log response elsewhere.
export async function createServiceClient(env, request) {
  const name = String(request?.name || '').trim();
  if (name.length < 3 || name.length > 64 || !/^[a-zA-Z0-9 _.:-]+$/.test(name)) throw fault('Invalid service name', 400);
  const scopes = Array.isArray(request?.scopes || ['read']) ? [...new Set(request?.scopes || ['read'])] : [];
  if (!scopes.length || scopes.some(s => !permissions.has(s))) throw fault('Invalid scopes', 400);
  if (scopes.includes('media') && !scopes.includes('write')) throw fault('Media requires write permission', 400);
  if (scopes.includes('write') && request.confirm_writes !== true) throw fault('Explicit write confirmation required', 400);
  const configured = aliases(env);
  const shops = Array.isArray(request?.shops || []) ? [...new Set(request?.shops || [])] : [];
  // Deliberate mandatory shop allowlist. Never treat omitted shop IDs as "all shops".
  if (!shops.length || shops.some(s => !configured.includes(s))) throw fault('Select existing shops explicitly', 400);
  const prefixInput = request?.path_prefixes || [];
  if (!Array.isArray(prefixInput) || prefixInput.length > 30) throw fault('Invalid path_prefixes', 400);
  const prefixes = [...new Set(prefixInput.map(safePathPrefix))];
  if (!prefixes.length) throw fault('Specify permitted Etsy API path prefixes', 400);
  const id = crypto.randomUUID();
  const token = 'hubc_' + id + '.' + key();
  const created_at = Date.now();
  await env.DB.prepare('INSERT INTO hub_clients(id,name,token_hash,scopes,shops,path_prefixes,created_at,revoked_at,last_used_at) VALUES(?,?,?,?,?,?,?,NULL,NULL)')
    .bind(id,name,await digest(token),JSON.stringify(scopes),JSON.stringify(shops),JSON.stringify(prefixes),created_at).run();
  return { ...readonlyDetails({id,name,scopes:JSON.stringify(scopes),shops:JSON.stringify(shops),path_prefixes:JSON.stringify(prefixes),created_at,revoked_at:null,last_used_at:null}), token };
}
export async function revokeServiceClient(env,id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw fault('Invalid client ID',400);
  const result = await env.DB.prepare('UPDATE hub_clients SET revoked_at=? WHERE id=? AND revoked_at IS NULL').bind(Date.now(),id).run();
  return Boolean(result.meta?.changes);
}
export async function authenticateServiceClient(req,env) {
  const authorization = req.headers.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const match = /^hubc_([0-9a-f-]{36})\.([0-9a-f]{64})$/i.exec(token);
  if (!match) return null;
  const row = await env.DB.prepare('SELECT * FROM hub_clients WHERE id=? AND revoked_at IS NULL').bind(match[1]).first();
  if (!row) return null;
  if ((await digest(token)) !== row.token_hash) return null;
  if (!row.last_used_at || row.last_used_at < Date.now()-300000) {
    // Best-effort activity time for owner diagnostics; never fail a valid request if audit metadata cannot be updated.
    await env.DB.prepare('UPDATE hub_clients SET last_used_at=? WHERE id=? AND (last_used_at IS NULL OR last_used_at<?)').bind(Date.now(),row.id,Date.now()-300000).run().catch(()=>{});
  }
  return readonlyDetails(row);
}
export function requireServiceAccess(client,env,body,method,uploads = false) {
  if (!client) throw fault('Service access token required',401);
  const valid = aliases(env);
  const alias = body?.shop || valid[0];
  if (!alias || !client.shops.includes(alias)) throw fault('Shop access denied',403);
  const apiPath = normalizeApiPath(body?.path || body?.apiPath);
  // Match at path segment boundaries; /receipts/1 never grants /receipts/10.
  if (!client.path_prefixes.some(prefix => apiPath === prefix || apiPath.startsWith(prefix + '/'))) throw fault('Etsy endpoint not permitted for this service',403);
  const verb = String(method || body?.method || 'GET').toUpperCase();
  if (!verbs.has(verb)) throw fault('Unsupported method',400);
  if (verb === 'GET') {
    if (!client.scopes.includes('read')) throw fault('Read access denied',403);
    if (uploads) throw fault('File upload requires a write method',400);
  } else {
    if (env.ENABLE_WRITES !== 'true') throw fault('Writes disabled during migration',403);
    if (!client.scopes.includes('write')) throw fault('Write access denied',403);
    if (uploads && !client.scopes.includes('media')) throw fault('Media upload access denied',403);
  }
  return { shop: alias, method: verb, apiPath };
}
