import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSafeServerConfig, isLoopbackHost } from '../src/server-security.mjs';
import { localMcpTools, createStdioHandler } from '../src/stdio-handler.mjs';

test('loopback requires no token', () => {
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('::1'), true);
  assert.doesNotThrow(() => assertSafeServerConfig({server:{host:'127.0.0.1'}},null));
});
test('external binds require tokens', () => {
  for (const host of ['0.0.0.0','::','192.168.1.10']) {
    assert.throws(() => assertSafeServerConfig({server:{host}},null),/Refusing non-loopback/);
    assert.doesNotThrow(() => assertSafeServerConfig({server:{host}},'secret'));
  }
});
test('HTTPS enforced for remote MCP public_base_url', () => {
  assert.throws(() => assertSafeServerConfig({server:{host:'127.0.0.1',public_base_url:'http://example.org'}},'secret'),/HTTPS/);
});
test('stdio lists 77 MCP tools without remote OAuth metadata', async () => {
  assert.equal(localMcpTools().length,77);
  assert(localMcpTools().every(x => !Object.hasOwn(x,'securitySchemes')));
  const handle=createStdioHandler({call:async()=>({ok:true})});
  assert.equal((await handle({jsonrpc:'2.0',id:1,method:'initialize'})).result.serverInfo.name,'etsy-mcp-hub');
  assert.equal((await handle({jsonrpc:'2.0',id:2,method:'tools/list'})).result.tools.length,77);
  assert.deepEqual((await handle({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'etsy_shops',arguments:{}}})).result.structuredContent,{ok:true});
  assert.equal(await handle({jsonrpc:'2.0',method:'notifications/initialized'}),null);
});
test('unknown stdio tools rejected', async () => {
  const handle=createStdioHandler({call:async()=>{throw Error('unexpected');}});
  assert.equal((await handle({jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'missing'}})).error.code,-32602);
});

test('stdio optional read-only mode hides and blocks writes', async () => {
  const tools = localMcpTools({readOnly:true});
  assert(tools.length > 0);
  assert(tools.every(t => t.annotations.readOnlyHint === true));
  let count=0;
  const handle=createStdioHandler({call:async()=>{count++;return {ok:true};}}, {readOnly:true});
  const forbidden=await handle({jsonrpc:'2.0',id:10,method:'tools/call',params:{name:'etsy_request_write',arguments:{}}});
  assert.equal(forbidden.error.code,-32602);
  assert.equal(count,0);
  const allowed=await handle({jsonrpc:'2.0',id:11,method:'tools/call',params:{name:'etsy_shops',arguments:{}}});
  assert.equal(allowed.result.structuredContent.ok,true);
  assert.equal(count,1);
});
