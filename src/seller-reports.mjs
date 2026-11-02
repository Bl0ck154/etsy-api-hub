function assertRange(value, name, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(name + ' must be an integer between ' + minimum + ' and ' + maximum);
  }
}
export async function buildLowStockReport(hub, { shop = null, threshold = 3, limit = 10 } = {}) {
  assertRange(threshold, '--threshold', 0, 10000);
  assertRange(limit, '--limit', 1, 25);
  const listings = await hub.listListings({ shop, state: 'active', limit });
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
  return {
    report: 'low-stock', shop, threshold, read_only: true,
    listings_checked: items.length, listings_available: listings.data?.count ?? null,
    partial_page: items.length >= limit, no_inventory_count: noInventory, flagged_count: flagged.length, flagged
  };
}

export function summarizeUnshippedReceipts(result, { shop = null } = {}) {
  const data = result?.data;
  const receipts = Array.isArray(data?.results) ? data.results : [];
  return {
    report: 'unshipped', shop, filter: 'paid_unshipped', read_only: true,
    total_matching: data?.count ?? null, returned_count: receipts.length,
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
