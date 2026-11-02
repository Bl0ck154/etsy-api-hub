import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLowStockReport, summarizeUnshippedReceipts } from '../src/seller-reports.mjs';
import { ETSY_MCP_TOOLS } from '../src/mcp-tools.mjs';
import { EtsyMcpAdapter } from '../src/mcp-adapter.mjs';

test('low-stock flags enabled variants and ignores deleted or disabled records', async () => {
  const hub = {
    listListings: async () => ({ data: { count: 3, results: [
      { listing_id: 1, title: 'Green scarf' }, { listing_id: 2, title: 'Blue scarf' },
    ] } }),
    getInventory: async id => ({ data: { products: [
      { sku: 'x', offerings: [{ quantity: id === '1' ? 2 : 10, is_enabled: true }, { quantity: 0, is_enabled: false }] },
      { sku: 'deleted', is_deleted: true, offerings: [{ quantity: 0 }] }
    ] } })
  };
  const d = await buildLowStockReport(hub, { threshold: 3, limit: 2 });
  assert.equal(d.flagged_count, 1);
  assert.equal(d.flagged[0].listing_id, '1');
  assert.equal(d.flagged[0].low_variants, 1);
  assert.equal(d.flagged[0].minimum_quantity, 2);
  assert.equal(d.listings_checked, 2);
  assert.equal(d.partial_page, true);
  assert.equal(d.read_only, true);
});
test('low-stock restricts rate-limit risk and rejects invalid bounds before API access', async () => {
  let calls = 0;
  const hub = { listListings: async () => { calls++; return { data: { results: [] } }; } };
  for (const opts of [{ limit: 100 }, { limit: 0 }, { threshold: -1 }, { threshold: 1.25 }, { limit: NaN }]) {
    await assert.rejects(buildLowStockReport(hub, opts), /must be an integer/);
  }
  assert.equal(calls, 0);
});
test('low-stock empty inventory does not invent quantities', async () => {
  const hub = { listListings: async () => ({ data: { count: 1, results: [{ listing_id: 1 }] } }), getInventory: async () => ({ data: { products: [] } }) };
  const d = await buildLowStockReport(hub);
  assert.equal(d.flagged_count, 0);
});
test('seller reports exposed as read-only MCP tools', () => {
  const low = ETSY_MCP_TOOLS.find(t => t.name === 'etsy_report_low_stock');
  const pending = ETSY_MCP_TOOLS.find(t => t.name === 'etsy_report_unshipped');
  assert.equal(ETSY_MCP_TOOLS.length, 79);
  assert.equal(low.annotations.readOnlyHint, true);
  assert.equal(pending.annotations.readOnlyHint, true);
  assert.equal(low.inputSchema.properties.limit.maximum, 25);
});
test('MCP low-stock report delegates to shared Hub and does not write', async () => {
  const calls = [];
  const hub = {
    listListings: async opts => { calls.push(['list', opts]); return { data: { count: 0, results: [] } }; },
  };
  const adapter = new EtsyMcpAdapter(hub, {
    default_shop: 'main',
    shops: { main: { shop_id: '123456', credential_file: '/unused' } },
    server: { host: '127.0.0.1', port: 3737 }
  });
  const report = await adapter.call('etsy_report_low_stock', { limit: 5, threshold: 3 });
  assert.equal(report.flagged_count, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].limit, 5);
});

test('unshipped report omits personal buyer information', () => {
  const sensitive = 'buyer-secret-address@example.test';
  const result = summarizeUnshippedReceipts({ data: { count: 1, results: [{
    receipt_id: 23, create_timestamp: 1234, is_paid: true, is_shipped: false,
    name: sensitive, first_line: sensitive, buyer_email: sensitive, message_from_buyer: sensitive,
    transactions: [{transaction_id: 1}, {transaction_id: 2}]
  }] } }, { shop: 'main' });
  assert.equal(result.returned_count, 1);
  assert.equal(result.orders[0].transactions_count, 2);
  assert.equal(JSON.stringify(result).includes(sensitive), false);
});
test('inventory 404 for no-record listings is counted without hiding other failures', async () => {
  const hub = {
    listListings: async () => ({ data: { results: [{ listing_id: 1 }] } }),
    getInventory: async () => { throw Object.assign(new Error('missing record'), { status: 404 }); }
  };
  const report = await buildLowStockReport(hub);
  assert.equal(report.no_inventory_count, 1);
  await assert.rejects(buildLowStockReport({
    ...hub, getInventory: async () => { throw Object.assign(new Error('auth error'), { status: 401 }); }
  }), /auth error/);
});
