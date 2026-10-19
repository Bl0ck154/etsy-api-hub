import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.mjs';

const url = 'https://etsy-api-hub-malinary.malinary-art.workers.dev';
const owner = 'test-only-admin-bearer-longer-than-thirty-two-characters';
const env = {
  SHOPS_JSON: '{"main":{"shop_id":"12345678"},"secondary":{"shop_id":"98765432"}}',
  ENABLE_WRITES: 'false',
  ADMIN_BEARER: owner
};
const req = (path, body, authorization = owner) => new Request(url + path, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'content-type': 'application/json', ...(authorization ? { authorization: 'Bearer ' + authorization } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});
test('public health contains no secrets or active Etsy credentials', async () => {
  const r = await worker.fetch(req('/health'), env);
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.configured_shops, 2);
  assert.equal(b.ok, true);
  assert.equal(b.oauth_ready, false);
  assert.equal(JSON.stringify(b).includes(owner), false);
});
test('GPT schema is independent of VPS and does not expose secrets', async () => {
  const r = await worker.fetch(req('/gpt/openapi.json'), env);
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.servers[0].url, url);
  assert.equal(b.paths['/gpt/read'].post['x-openai-isConsequential'], false);
  assert.equal(b.paths['/gpt/write'].post['x-openai-isConsequential'], true);
});
test('MCP requires authentication even for reads', async () => {
  const r = await worker.fetch(req('/mcp', {jsonrpc:'2.0', id:1, method:'tools/list'}, ''), env);
  assert.equal(r.status, 401);
});
test('MCP reuses full existing tool definitions', async () => {
  const r = await worker.fetch(req('/mcp', {jsonrpc:'2.0', id:1, method:'tools/list'}), env);
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.ok(b.result.tools.length >= 60);
  assert.ok(b.result.tools.some(t => t.name === 'etsy_request_read'));
  assert.ok(b.result.tools.some(t => t.name === 'etsy_request_multipart'));
});
test('MCP shop metadata uses configured aliases, no network or credentials', async () => {
  const r = await worker.fetch(req('/mcp', {jsonrpc:'2.0', id:2, method:'tools/call',params:{name:'etsy_shops',arguments:{}}}),env);
  const b = await r.json();
  assert.equal(b.result.structuredContent.default_shop, 'main');
  assert.equal(b.result.structuredContent.shops.secondary.shop_id, '98765432');
});
test('MCP consequential write is rejected during cutover', async () => {
  const r = await worker.fetch(req('/mcp', {jsonrpc:'2.0', id:3, method:'tools/call',params:{name:'etsy_request_write',arguments:{shop:'main',method:'DELETE',path:'/application/listings/1'}}}),env);
  const b = await r.json();
  assert.equal(b.result.isError, true);
  assert.match(b.result.content[0].text, /Writes disabled/);
});
test('GPT consequential write is rejected during cutover', async () => {
  const r = await worker.fetch(req('/gpt/write', {shop:'main',method:'DELETE',path:'/application/listings/1'}),env);
  assert.equal(r.status,401); // GPT Actions now require dedicated scoped service tokens.
});
test('owner bootstrap routes require admin bearer', async () => {
  const r = await worker.fetch(req('/admin/status',undefined,''),env);
  assert.equal(r.status,401);
});

const onlyOwner = {
  SHOPS_JSON: '{"main":{"shop_id":"12345678"}}',
  ENABLE_WRITES: 'false',
  MCP_OWNER_PASSWORD: 'this-is-a-test-owner-password-very-long-not-production',
  DB: {prepare: () => ({all: async () => ({results:[]}), first:async()=>({count:0})})}
};
test('one strong owner password unlocks read-only MCP without extra key secrets', async () => {
  const r = await worker.fetch(req('/mcp', { jsonrpc:'2.0',id:51,method:'tools/list' }, onlyOwner.MCP_OWNER_PASSWORD), onlyOwner);
  assert.equal(r.status, 200);
  assert.ok((await r.json()).result.tools.length >= 60);
});
test('owner password is sufficient for readiness, not echoed in health output', async () => {
  const r = await worker.fetch(req('/health'), onlyOwner);
  const body = await r.json();
  assert.equal(body.oauth_ready,true);
  assert.equal(body.etsy_ready,false);
  assert.equal(JSON.stringify(body).includes(onlyOwner.MCP_OWNER_PASSWORD),false);
});
test('web setup page offers shop choice and password without revealing it', async () => {
  const r = await worker.fetch(req('/admin/connect'),onlyOwner);
  assert.equal(r.status,200);
  const page = await r.text();
  assert.match(page,/Connect Etsy shop/);
  assert.match(page,/type="password"/);
  assert.equal(page.includes(onlyOwner.MCP_OWNER_PASSWORD),false);
});
test('browser setup forbids cross-origin POSTs', async () => {
  const request = new Request(url + '/admin/connect', {
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','origin':'https://evil.example'},
    body:new URLSearchParams({shop:'main',password:onlyOwner.MCP_OWNER_PASSWORD})
  });
  assert.equal((await worker.fetch(request,onlyOwner)).status,403);
});

test('scheduled housekeeping prunes only ephemeral OAuth/audit, not Etsy tokens or backups', async () => {
  const {maintenance} = await import('../worker.mjs');
  const deleted=[];
  const fake={
    DB:{prepare(sql){return {bind(...params){return {run:async()=>{deleted.push(sql);return {meta:{changes:0}};}}}}}}
  };
  const result=await maintenance(fake);
  assert.equal(result.ok,true);
  assert.equal(deleted.length,5);
  assert.ok(deleted.some(s=>s.includes('mcp_refresh')));
  assert.ok(deleted.some(s=>s.includes('hub_audit')));
  assert.equal(deleted.some(s=>s.includes('hub_tokens')),false);
  assert.equal(deleted.some(s=>s.includes('hub_snapshots')),false);
  assert.equal(deleted.some(s=>s.includes('hub_clients')),false);
});


test('login works when Firefox/privacy browsers omit Origin using strict same-site CSRF', async () => {
  const rows=[];
  const db={prepare(sql){return {all:async()=>({results:[]}),bind(...args){return {first:async()=>null, run:async()=>{rows.push({sql, args});return {meta:{changes:1}};}}}}}};
  const browserEnv={...onlyOwner,DB:db,ETSY_CLIENT_ID:'test-id',ETSY_CLIENT_SECRET:'test-secret'};
  const page=await worker.fetch(req('/admin/connect'),browserEnv);
  assert.equal(page.status,200);
  const cookie=page.headers.get('set-cookie');
  assert.match(cookie,/HttpOnly; SameSite=Strict/);
  const nonce=(await page.text()).match(/name="_csrf" value="([^"]+)"/)?.[1];
  assert.ok(nonce?.length>=32);
  const form=new URLSearchParams({shop:'main',password:onlyOwner.MCP_OWNER_PASSWORD,_csrf:nonce});
  const request=new Request(url+'/admin/connect',{method:'POST',headers:{'cookie':cookie.split(';')[0],'content-type':'application/x-www-form-urlencoded','sec-fetch-site':'same-origin'},body:form.toString()});
  const response=await worker.fetch(request,browserEnv);
  assert.equal(response.status,302);
  assert.match(response.headers.get('location'),/^https:\/\/www\.etsy\.com\/oauth\/connect\?/);
  assert.equal(rows.some(x=>x.sql.includes('INSERT INTO hub_oauth')),true);
  const denied=await worker.fetch(new Request(url+'/admin/connect',{method:'POST',headers:{'cookie':cookie.split(';')[0],'content-type':'application/x-www-form-urlencoded','sec-fetch-site':'cross-site'},body:form.toString()}),browserEnv);
  assert.equal(denied.status,403);
  const missing=await worker.fetch(new Request(url+'/admin/connect',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form.toString()}),browserEnv);
  assert.equal(missing.status,403);
});


test('Etsy getShopByOwnerUserId returns one shop object, not a results collection', async () => {
  const {ownsEtsyShop} = await import('../worker.mjs');
  assert.equal(ownsEtsyShop({shop_id:23207964,user_id:123},'23207964'),true);
  assert.equal(ownsEtsyShop({shop_id:'33448161',user_id:456},33448161),true);
  assert.equal(ownsEtsyShop({shop_id:'33448161'},23207964),false);
  assert.equal(ownsEtsyShop({results:[{shop_id:23207964}]},23207964),false);
  assert.equal(ownsEtsyShop(null,23207964),false);
  assert.equal(ownsEtsyShop({},23207964),false);
});

test('shop setup shows connected main, separate actionable second shop, no redundant main form', async () => {
  const fixtureDB={prepare(sql){return {all:async()=>({results:[{alias:'main'}]})};}};
  const page=await worker.fetch(req('/admin/connect'),{...env,DB:fixtureDB});
  assert.equal(page.status,200);
  const body=await page.text();
  assert.match(body,/main <span class="status">Connected/);
  assert.match(body,/secondary <span class="pending">Not connected/);
  assert.match(body,/Connect secondary on Etsy/);
  assert.doesNotMatch(body,/Connect main on Etsy/);
  assert.match(body,/private window or separate browser/);
});
test('Etsy OAuth decline shows human-readable error', async () => {
  const err='error=access_denied&error_description=Seller%20app%20limit';
  const res=await worker.fetch(req('/admin/oauth/callback?'+err),env);
  assert.equal(res.status,400);
  assert.match(await res.text(),/Seller app limit/);
});

test('unconfigured second Seller App presents setup steps rather than a broken OAuth button',async () => {
  const local = {
    ...onlyOwner,
    SHOPS_JSON: '{"main":{"shop_id":"23207964"},"second":{"shop_id":"33448161"}}',
    ETSY_SECOND_CLIENT_ID: 'SET_SECOND_ETSY_CLIENT_ID_HERE',
    ETSY_SECOND_CLIENT_SECRET: 'SET_SECOND_ETSY_CLIENT_SECRET_HERE',
    DB: {prepare:()=>({all:async()=>({results:[{alias:'main'}]})})}
  };
  const resp=await worker.fetch(req('/admin/connect'),local);
  assert.equal(resp.status,200);
  const html=await resp.text();
  assert.match(html,/Separate Etsy app needed/);
  assert.match(html,/ETSY_SECOND_CLIENT_ID/);
  assert.doesNotMatch(html,/Connect second on Etsy/);
  assert.match(html,/main <span class="status">Connected/);
});
test('second Etsy app can be configured independently and exposes its login button',async () => {
  const local = {
    ...onlyOwner,
    SHOPS_JSON: '{"main":{"shop_id":"23207964"},"second":{"shop_id":"33448161"}}',
    ETSY_SECOND_CLIENT_ID:'second-app-key-value',
    ETSY_SECOND_CLIENT_SECRET:'second-app-secret-value',
    DB:{prepare:()=>({all:async()=>({results:[{alias:'main'}]})})}
  };
  const resp=await worker.fetch(req('/admin/connect'),local);
  const body=await resp.text();
  assert.match(body,/Connect second on Etsy/);
  assert.doesNotMatch(body,/second-app-secret-value/);
});
