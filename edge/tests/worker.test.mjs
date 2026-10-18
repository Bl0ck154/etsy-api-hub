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
  assert.equal(r.status,403);
});
test('owner bootstrap routes require admin bearer', async () => {
  const r = await worker.fetch(req('/admin/status',undefined,''),env);
  assert.equal(r.status,401);
});
