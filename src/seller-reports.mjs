function assertRange(value, name, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(name + ' must be an integer between ' + minimum + ' and ' + maximum);
  }
}
export async function buildLowStockReport(hub, { shop = null, threshold = 3, limit = 10, offset = 0 } = {}) {
  assertRange(threshold, '--threshold', 0, 10000);
  assertRange(limit, '--limit', 1, 25);
  assertRange(offset, '--offset', 0, 1000000);
  const listings = await hub.listListings({ shop, state: 'active', limit, offset });
  const items = Array.isArray(listings.data?.results) ? listings.data.results : [];
  const flagged = [];
  let noInventory = 0;
  for (const item of items) {
    const listingId = String(item.listing_id || '');
    if (!/^\d+$/.test(listingId)) continue;
    let result;
    try { result = await hub.getInventory(listingId, { shop }); }
    catch (error) {
      // Etsy may return 404 for listings without an inventory record. Propagate other failures.
      if (error?.status === 404) { noInventory += 1; continue; }
      throw error;
    }
    const products = Array.isArray(result.data?.products) ? result.data.products : [];
    const quantities = products.filter(p => !p.is_deleted)
      .flatMap(p => (p.offerings || []).filter(o => !o.is_deleted && o.is_enabled !== false && Number.isInteger(o.quantity)).map(o => o.quantity));
    if (!quantities.length) { noInventory += 1; continue; }
    const lowCount = quantities.filter(q => q <= threshold).length;
    if (lowCount) flagged.push({
      listing_id: listingId, title: item.title || '',
      low_variants: lowCount, variants_checked: quantities.length,
      minimum_quantity: Math.min(...quantities)
    });
  }
  const available = Number.isInteger(listings.data?.count) ? listings.data.count : null;
  const more = available === null ? items.length === limit : offset + items.length < available;
  return {
    report: 'low-stock', shop, threshold, read_only: true,
    offset, limit, next_offset: more && items.length ? offset + items.length : null,
    listings_checked: items.length, listings_available: available,
    partial_page: more, no_inventory_count: noInventory, flagged_count: flagged.length, flagged
  };
}

export function summarizeUnshippedReceipts(result, { shop = null, offset = 0, limit = 20 } = {}) {
  const data = result?.data;
  const receipts = Array.isArray(data?.results) ? data.results : [];
  const total = Number.isInteger(data?.count) ? data.count : null;
  const more = total === null ? receipts.length === limit : offset + receipts.length < total;
  return {
    report: 'unshipped', shop, filter: 'paid_unshipped', read_only: true,
    total_matching: total, returned_count: receipts.length, offset, limit,
    next_offset: more && receipts.length ? offset + receipts.length : null,
    // Do not send buyer names, email addresses, or shipping addresses to the model unnecessarily.
    orders: receipts.map(receipt => ({
      receipt_id: receipt.receipt_id ?? null,
      created_timestamp: receipt.create_timestamp ?? null,
      paid_timestamp: receipt.paid_timestamp ?? null,
      is_paid: receipt.is_paid ?? null,
      is_shipped: receipt.is_shipped ?? null,
      transactions_count: Array.isArray(receipt.transactions) ? receipt.transactions.length : null,
    }))
  };
}
