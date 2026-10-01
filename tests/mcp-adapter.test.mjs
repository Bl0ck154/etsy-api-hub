import assert from 'node:assert/strict';
import test from 'node:test';
import { ETSY_MCP_TOOLS, MODERN_MCP_VERSION, EtsyMcpAdapter } from '../src/mcp-adapter.mjs';

test('MCP exposes bounded typed Etsy tools plus full API escape hatches', () => {
  assert.equal(MODERN_MCP_VERSION, '2026-07-28');
  assert.equal(ETSY_MCP_TOOLS.length, 15);
  const names = ETSY_MCP_TOOLS.map(tool => tool.name);
  assert.equal(new Set(names).size, names.length);
  for (const tool of ETSY_MCP_TOOLS) {
    assert.deepEqual(tool.securitySchemes, [{ type: 'oauth2', scopes: ['etsy'] }]);
    assert.deepEqual(tool._meta.securitySchemes, tool.securitySchemes);
  }
  assert.equal(ETSY_MCP_TOOLS.find(tool => tool.name === 'etsy_shops').annotations.readOnlyHint, true);
  assert.equal(ETSY_MCP_TOOLS.find(tool => tool.name === 'etsy_listing_update').annotations.readOnlyHint, false);
  assert.equal(ETSY_MCP_TOOLS.find(tool => tool.name === 'etsy_request_write').annotations.destructiveHint, true);
});

test('MCP shop discovery exposes only public shop metadata', async () => {
  const config = {
    default_shop: 'main',
    shops: {
      main: { shop_id: '23207964', credential_file: '/secret/main.json' },
      second: { shop_id: '33448161', credential_file: '/secret/second.json' },
    },
    server: { host: '127.0.0.1', port: 3737, auth_token_file: '/secret/token' },
  };
  const adapter = new EtsyMcpAdapter({}, config);
  const value = await adapter.call('etsy_shops', {});
  assert.deepEqual(value.shops, {
    main: { shop_id: '23207964' },
    second: { shop_id: '33448161' },
  });
  assert.equal(JSON.stringify(value).includes('credential_file'), false);
  assert.equal(JSON.stringify(value).includes('/secret/'), false);
});
