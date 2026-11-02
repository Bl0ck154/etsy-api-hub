# Seller workflows demo

The following output is **fictional test data**, not a real Etsy shop. It illustrates how the tools can help an authorized seller. The program performs read-only operations here.

## Check low inventory

```text
Seller: Which of my first 10 active listings have a variant with 3 or fewer items?
Assistant calls: etsy_report_low_stock { "threshold": 3, "limit": 10 }

Result (illustrative):
{
  "report": "low-stock",
  "listings_checked": 10,
  "offset": 0,
  "limit": 10,
  "next_offset": null,
  "flagged_count": 2,
  "flagged": [
    { "listing_id": "1001", "title": "Linen scarf", "low_variants": 1, "minimum_quantity": 2 },
    { "listing_id": "1002", "title": "Ceramic mug", "low_variants": 1, "minimum_quantity": 1 }
  ],
  "read_only": true
}
```

The tool requests inventory for up to 25 active listings, sequentially. Use `offset` (or CLI `--offset`) to inspect further pages when `next_offset` is returned. It ignores disabled/deleted variants and does not write inventory. It is **not** a full-shop scan unless every listing has been covered, and some listings lack inventory records.

## Review unshipped paid orders

```text
Seller: Show paid orders that haven't shipped yet.
Assistant calls: etsy_report_unshipped { "limit": 20 }

Result (illustrative):
{
  "report": "unshipped",
  "filter": "paid_unshipped",
  "returned_count": 1,
  "offset": 0,
  "limit": 20,
  "next_offset": null,
  "orders": [{ "receipt_id": 2001, "created_timestamp": 1790000000, "is_paid": true, "is_shipped": false }],
  "read_only": true
}
```

Unlike raw Etsy order responses, this report does not include buyer names, email addresses, or shipping addresses.

## Carefully prepare a listing update

The assistant can read current listing data, show a proposed change, and request explicit user approval **before** calling a write tool. Approval policy is provided by the AI client, not by the Hub. Typed writes create backups where supported; raw writes do not guarantee them.

## Other examples

- Inspect image and video ranks before a listing media change.
- Check personalization question limits on a seller listing.
- Export inventory data with `etsyctl` to a private local script.
- Retrieve a paid transaction summary with the required OAuth scope.

For first installation, follow the [Quick Start](QUICKSTART.md).
