import assert from 'node:assert/strict';
import test from 'node:test';
import { ETSY_MCP_TOOLS, MODERN_MCP_VERSION, EtsyMcpAdapter } from '../src/mcp-adapter.mjs';

const config = {
  default_shop: 'main',
  shops: {
    main: { shop_id: '23207964', credential_file: '/secret/main.json' },
    second: { shop_id: '33448161', credential_file: '/secret/second.json' },
  },
  server: { host: '127.0.0.1', port: 3737, auth_token_file: '/secret/token' },
};

function requestHub() {
  const calls = [];
  const hub = {
    shop(alias = null) {
      const name = alias || config.default_shop;
      return { alias: name, ...config.shops[name], shop_id: String(config.shops[name].shop_id) };
    },
    async request(input) {
      calls.push(input);
      return { data: { ok: true }, meta: { status: 200 } };
    },
  };
  return { hub, calls };
}

test('MCP exposes broad typed coverage plus three full API escape hatches', () => {
  assert.equal(MODERN_MCP_VERSION, '2026-07-28');
  assert.ok(ETSY_MCP_TOOLS.length >= 60);
  const names = ETSY_MCP_TOOLS.map(tool => tool.name);
  assert.equal(new Set(names).size, names.length);
  for (const tool of ETSY_MCP_TOOLS) {
    assert.deepEqual(tool.securitySchemes, [{ type: 'oauth2', scopes: ['etsy'] }]);
    assert.deepEqual(tool._meta.securitySchemes, tool.securitySchemes);
  }
  for (const raw of ['etsy_request_read', 'etsy_request_write', 'etsy_request_multipart']) assert.ok(names.includes(raw));
  for (const expected of [
    'etsy_orders_list', 'etsy_transactions_list', 'etsy_reviews_list', 'etsy_ledger_entries',
    'etsy_image_upload', 'etsy_video_upload', 'etsy_file_upload', 'etsy_shipping_profile_write',
    'etsy_processing_profile_write', 'etsy_return_policy_write', 'etsy_taxonomy_get', 'etsy_user_me',
  ]) assert.ok(names.includes(expected), `${expected} should be exposed`);
  assert.equal(ETSY_MCP_TOOLS.find(tool => tool.name === 'etsy_shops').annotations.readOnlyHint, true);
  assert.equal(ETSY_MCP_TOOLS.find(tool => tool.name === 'etsy_listing_update').annotations.readOnlyHint, false);
  assert.equal(ETSY_MCP_TOOLS.find(tool => tool.name === 'etsy_request_write').annotations.destructiveHint, true);
});

test('MCP shop discovery and capabilities never expose credential paths', async () => {
  const { hub } = requestHub();
  const adapter = new EtsyMcpAdapter(hub, config);
  const shops = await adapter.call('etsy_shops', {});
  assert.deepEqual(shops.shops, {
    main: { shop_id: '23207964' },
    second: { shop_id: '33448161' },
  });
  const capabilities = await adapter.call('etsy_capabilities', {});
  const shown = JSON.stringify({ shops, capabilities });
  assert.equal(shown.includes('credential_file'), false);
  assert.equal(shown.includes('/secret/'), false);
  assert.equal(capabilities.known_official_endpoint_count, 105);
  assert.match(capabilities.full_raw_access.reads, /any \/application\/\*/);
  assert.match(capabilities.full_raw_access.multipart_writes, /multipart/i);
});

test('typed order history forwards every current date/status filter', async () => {
  const seen = [];
  const hub = {
    shop: alias => ({ alias: alias || 'main', shop_id: '23207964' }),
    async listReceipts(options) { seen.push(options); return { data: { count: 0, results: [] }, meta: { status: 200 } }; },
  };
  const adapter = new EtsyMcpAdapter(hub, config);
  await adapter.call('etsy_orders_list', {
    shop: 'main', min_created: 100, max_created: 200, min_last_modified: 110, max_last_modified: 210,
    limit: 50, offset: 3, sort_on: 'created', sort_order: 'down', was_paid: true, was_shipped: false,
    was_delivered: false, was_canceled: false, legacy: false,
  });
  assert.deepEqual(seen[0], {
    shop: 'main', limit: 50, offset: 3, minCreated: 100, maxCreated: 200,
    minLastModified: 110, maxLastModified: 210, sortOn: 'created', sortOrder: 'down',
    wasPaid: true, wasShipped: false, wasDelivered: false, wasCanceled: false, legacy: false,
  });
});

test('raw read forwards arbitrary query parameters instead of hiding new Etsy filters', async () => {
  const { hub, calls } = requestHub();
  const adapter = new EtsyMcpAdapter(hub, config);
  await adapter.call('etsy_request_read', {
    path: '/application/shops/23207964/receipts',
    query: { min_created: 1, max_created: 2, future_filter: 'kept' },
  });
  assert.deepEqual(calls[0].query, { min_created: 1, max_created: 2, future_filter: 'kept' });
  assert.equal(calls[0].method, 'GET');
});

test('raw write supports URL-encoded form and rejects ambiguous body+form', async () => {
  const { hub, calls } = requestHub();
  const adapter = new EtsyMcpAdapter(hub, config);
  await adapter.call('etsy_request_write', {
    method: 'POST', path: '/application/example', form: { one: 'two' }, query: { q: 1 },
  });
  assert.deepEqual(calls[0].form, { one: 'two' });
  assert.equal(calls[0].body, undefined);
  await assert.rejects(
    adapter.call('etsy_request_write', { method: 'POST', path: '/application/example', form: { one: 'two' }, body: { three: 4 } }),
    /mutually exclusive/,
  );
});

test('generic multipart forwards base64 files without accepting server file paths', async () => {
  const { hub, calls } = requestHub();
  const adapter = new EtsyMcpAdapter(hub, config);
  await adapter.call('etsy_request_multipart', {
    method: 'POST',
    path: '/application/shops/23207964/listings/123/images',
    form: { rank: 2 },
    files: [{ field: 'image', name: 'sample.jpg', mime_type: 'image/jpeg', content_base64: 'YWJj' }],
  });
  assert.equal(calls[0].multipart, true);
  assert.deepEqual(calls[0].files, [{ field: 'image', name: 'sample.jpg', mime_type: 'image/jpeg', content_base64: 'YWJj' }]);
  assert.equal(Object.hasOwn(calls[0].files[0], 'path'), false);
});

test('typed media upload requires bytes or an existing Etsy media id', async () => {
  const hub = { shop: () => ({ alias: 'main', shop_id: '23207964' }) };
  const adapter = new EtsyMcpAdapter(hub, config);
  await assert.rejects(adapter.call('etsy_image_upload', { listing_id: '123' }), /file or listing_image_id is required/);
  await assert.rejects(adapter.call('etsy_video_upload', { listing_id: '123' }), /file or video_id is required/);
  await assert.rejects(adapter.call('etsy_file_upload', { listing_id: '123' }), /file or listing_file_id is required/);
});
