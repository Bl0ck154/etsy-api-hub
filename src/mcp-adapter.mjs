import { publicConfig } from './config.mjs';
import { ETSY_MCP_TOOLS } from './mcp-tools.mjs';

export { ETSY_MCP_TOOLS } from './mcp-tools.mjs';
export const MODERN_MCP_VERSION = '2026-07-28';
const LEGACY_MCP_VERSION = '2025-06-18';
const MAX_MCP_BODY = 192 * 1024 * 1024;

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const b = Buffer.from(chunk);
    total += b.length;
    if (total > MAX_MCP_BODY) throw Object.assign(new Error('MCP request body too large'), { code: 'MCP_BODY_TOO_LARGE' });
    chunks.push(b);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function jsonRpcError(res, id, code, message, status = 400) {
  sendJson(res, status, { jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}

function exposedResult(result) {
  if (!result || typeof result !== 'object') return result;
  const out = {};
  if (Object.prototype.hasOwnProperty.call(result, 'data')) out.data = result.data;
  if (Object.prototype.hasOwnProperty.call(result, 'meta')) out.meta = result.meta;
  if (Object.prototype.hasOwnProperty.call(result, 'backup')) out.backup = result.backup;
  return Object.keys(out).length ? out : result;
}

function toolResult(value, isError = false) {
  const structuredContent = value && typeof value === 'object' ? value : { value };
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  };
}

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function need(value, name) {
  if (value === undefined || value === null || value === '') fail('INVALID_ARGUMENT', `${name} is required`);
  return String(value);
}

function defined(values = {}) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

function mergeQuery(extra, values) {
  return { ...(extra && typeof extra === 'object' ? extra : {}), ...defined(values) };
}

function fileArg(file, field = undefined) {
  if (!file) return null;
  return {
    ...(field ? { field } : {}),
    name: file.name,
    mime_type: file.mime_type,
    content_base64: file.content_base64,
  };
}

export class EtsyMcpAdapter {
  constructor(hub, config) {
    this.hub = hub;
    this.config = config;
  }

  shop(alias = null) {
    return this.hub.shop(alias);
  }

  async api(shopAlias, method, apiPath, { query, body, form, files, multipart = false, operation = 'mcp.typed' } = {}) {
    return exposedResult(await this.hub.request({
      shop: shopAlias,
      method,
      apiPath,
      query,
      body,
      form,
      files,
      multipart,
      operation,
    }));
  }

  async call(name, args = {}) {
    const shopAlias = args.shop || null;
    const cfg = () => this.shop(shopAlias);
    const shopPath = suffix => `/application/shops/${cfg().shop_id}${suffix}`;

    switch (name) {
      case 'etsy_capabilities':
        return {
          connector: 'My Etsy / Etsy API Hub',
          official_spec_snapshot: 'Etsy Open API v3 guidance 2026-07-08',
          known_official_endpoint_count: 105,
          typed_tool_count: ETSY_MCP_TOOLS.length - 3,
          full_raw_access: {
            reads: 'etsy_request_read can GET any /application/* endpoint and pass arbitrary query parameters.',
            json_or_form_writes: 'etsy_request_write can POST/PUT/PATCH/DELETE any /application/* endpoint with JSON or URL-encoded form data.',
            multipart_writes: 'etsy_request_multipart can POST/PUT/PATCH multipart/form-data with base64 file bytes.',
            rule: 'If a typed tool does not expose a current Etsy filter or endpoint, use the raw fallback rather than reporting the connector as unsupported.',
          },
          endpoint_groups: [
            'listings', 'listing files', 'listing images', 'listing videos', 'inventory', 'properties', 'personalization',
            'translations', 'variation images', 'orders/receipts', 'transactions', 'payments/ledger', 'reviews',
            'shipping profiles', 'processing profiles', 'return policies', 'shop sections', 'holiday preferences',
            'production partners', 'buyer/seller taxonomy', 'users/addresses', 'shipping carriers',
          ],
          configured_shops: publicConfig(this.config),
        };

      case 'etsy_shops':
        return publicConfig(this.config);
      case 'etsy_openapi_ping':
        return this.api(shopAlias, 'GET', '/application/openapi-ping', { operation: 'mcp.openapi.ping' });
      case 'etsy_shop_get':
        return this.api(shopAlias, 'GET', shopPath(''), { operation: 'mcp.shop.get' });
      case 'etsy_shop_update':
        return this.api(shopAlias, 'PUT', shopPath(''), { form: args.changes || {}, operation: 'mcp.shop.update' });
      case 'etsy_shop_search':
        return this.api(shopAlias, 'GET', '/application/shops', { query: defined({ shop_name: args.shop_name, limit: args.limit || 25, offset: args.offset || 0 }), operation: 'mcp.shop.search' });
      case 'etsy_shop_by_owner':
        return this.api(shopAlias, 'GET', `/application/users/${need(args.user_id, 'user_id')}/shops`, { operation: 'mcp.shop.owner' });

      case 'etsy_listings_list':
        return exposedResult(await this.hub.listListings({
          shop: shopAlias,
          state: args.state || 'active',
          limit: Number(args.limit || 25),
          offset: Number(args.offset || 0),
          sortOn: args.sort_on,
          sortOrder: args.sort_order,
          includes: args.includes,
        }));
      case 'etsy_listing_get':
        return exposedResult(await this.hub.getListing(args.listing_id, { shop: shopAlias, includes: args.includes }));
      case 'etsy_listing_create':
        return this.api(shopAlias, 'POST', shopPath('/listings'), { body: args.listing, operation: 'mcp.listing.create' });
      case 'etsy_listing_update':
        return exposedResult(await this.hub.updateListing(args.listing_id, args.changes || {}, { shop: shopAlias, backup: true }));
      case 'etsy_listing_delete':
        return exposedResult(await this.hub.deleteListing(args.listing_id, { shop: shopAlias, backup: true }));
      case 'etsy_listings_batch_get':
        return this.api(shopAlias, 'GET', '/application/listings/batch', { query: defined({ listing_ids: (args.listing_ids || []).join(','), includes: Array.isArray(args.includes) ? args.includes.join(',') : args.includes, legacy: args.legacy, currency: args.currency, buyer_country: args.buyer_country }), operation: 'mcp.listings.batch' });
      case 'etsy_listings_batch_inventory':
        return this.api(shopAlias, 'GET', '/application/listings/batch/inventory', { query: { listing_ids: (args.listing_ids || []).join(',') }, operation: 'mcp.listings.batch.inventory' });
      case 'etsy_listings_batch_shipping':
        return this.api(shopAlias, 'GET', '/application/listings/batch/shipping', { query: { listing_ids: (args.listing_ids || []).join(',') }, operation: 'mcp.listings.batch.shipping' });
      case 'etsy_listing_product_get':
        return this.api(shopAlias, 'GET', `/application/listings/${need(args.listing_id, 'listing_id')}/inventory/products/${need(args.product_id, 'product_id')}`, { query: defined({ legacy: args.legacy }), operation: 'mcp.listing.product.get' });
      case 'etsy_listing_offering_get':
        return this.api(shopAlias, 'GET', `/application/listings/${need(args.listing_id, 'listing_id')}/products/${need(args.product_id, 'product_id')}/offerings/${need(args.product_offering_id, 'product_offering_id')}`, { query: defined({ legacy: args.legacy }), operation: 'mcp.listing.offering.get' });

      case 'etsy_orders_list':
        return exposedResult(await this.hub.listReceipts({
          shop: shopAlias,
          limit: Number(args.limit || 25),
          offset: Number(args.offset || 0),
          minCreated: args.min_created,
          maxCreated: args.max_created,
          minLastModified: args.min_last_modified,
          maxLastModified: args.max_last_modified,
          sortOn: args.sort_on,
          sortOrder: args.sort_order,
          wasPaid: args.was_paid,
          wasShipped: args.was_shipped,
          wasDelivered: args.was_delivered,
          wasCanceled: args.was_canceled,
          legacy: args.legacy,
        }));
      case 'etsy_order_get':
        return exposedResult(await this.hub.getReceipt(args.receipt_id, { shop: shopAlias }));
      case 'etsy_order_update':
        return this.api(shopAlias, 'PUT', shopPath(`/receipts/${need(args.receipt_id, 'receipt_id')}`), { query: args.query, body: args.body, operation: 'mcp.order.update' });
      case 'etsy_order_shipment_create':
        return this.api(shopAlias, 'POST', shopPath(`/receipts/${need(args.receipt_id, 'receipt_id')}/tracking`), { query: defined({ legacy: args.legacy }), body: args.shipment, operation: 'mcp.order.shipment' });
      case 'etsy_transactions_list': { 
        const scope = args.scope || 'shop';
        let path;
        if (scope === 'listing') path = shopPath(`/listings/${need(args.listing_id, 'listing_id')}/transactions`);
        else if (scope === 'receipt') path = shopPath(`/receipts/${need(args.receipt_id, 'receipt_id')}/transactions`);
        else path = shopPath('/transactions');
        const query = mergeQuery(args.query, { limit: args.limit || 25, offset: args.offset || 0 });
        return this.api(shopAlias, 'GET', path, { query, operation: `mcp.transactions.${scope}` });
      }
      case 'etsy_transaction_get':
        return this.api(shopAlias, 'GET', shopPath(`/transactions/${need(args.transaction_id, 'transaction_id')}`), { operation: 'mcp.transaction.get' });

      case 'etsy_reviews_list': { 
        const scope = args.scope || 'shop';
        const path = scope === 'listing'
          ? `/application/listings/${need(args.listing_id, 'listing_id')}/reviews`
          : shopPath('/reviews');
        return this.api(shopAlias, 'GET', path, { query: defined({ limit: args.limit || 25, offset: args.offset || 0, min_created: args.min_created, max_created: args.max_created }), operation: `mcp.reviews.${scope}` });
      }
      case 'etsy_payments_get':
        return this.api(shopAlias, 'GET', shopPath('/payments'), { query: { payment_ids: (args.payment_ids || []).join(',') }, operation: 'mcp.payments.list' });
      case 'etsy_payment_by_receipt':
        return this.api(shopAlias, 'GET', shopPath(`/receipts/${need(args.receipt_id, 'receipt_id')}/payments`), { operation: 'mcp.payment.receipt' });
      case 'etsy_ledger_entries':
        return this.api(shopAlias, 'GET', shopPath('/payment-account/ledger-entries'), { query: defined({ min_created: args.min_created, max_created: args.max_created, limit: args.limit || 25, offset: args.offset || 0 }), operation: 'mcp.ledger.list' });
      case 'etsy_ledger_entry_get':
        return this.api(shopAlias, 'GET', shopPath(`/payment-account/ledger-entries/${need(args.ledger_entry_id, 'ledger_entry_id')}`), { operation: 'mcp.ledger.get' });
      case 'etsy_payments_by_ledger_entries':
        return this.api(shopAlias, 'GET', shopPath('/payment-account/ledger-entries/payments'), { query: { ledger_entry_ids: (args.ledger_entry_ids || []).join(',') }, operation: 'mcp.payments.ledger-entries' });

      case 'etsy_personalization_get':
        return exposedResult(await this.hub.getPersonalization(args.listing_id, { shop: shopAlias }));
      case 'etsy_personalization_set':
        return exposedResult(await this.hub.setPersonalization(args.listing_id, args.questions, { shop: shopAlias, backup: true }));
      case 'etsy_personalization_delete':
        return exposedResult(await this.hub.deletePersonalization(args.listing_id, { shop: shopAlias, backup: true }));
      case 'etsy_inventory_get':
        return exposedResult(await this.hub.getInventory(args.listing_id, { shop: shopAlias }));
      case 'etsy_inventory_set':
        return exposedResult(await this.hub.setInventory(args.listing_id, args.inventory, { shop: shopAlias, backup: true }));

      case 'etsy_images_list':
        return exposedResult(await this.hub.listImages(args.listing_id, { shop: shopAlias }));
      case 'etsy_image_get':
        return exposedResult(await this.hub.getImage(args.listing_id, args.image_id, { shop: shopAlias }));
      case 'etsy_image_upload':
        if (!args.file && !args.listing_image_id) fail('INVALID_ARGUMENT', 'file or listing_image_id is required');
        return exposedResult(await this.hub.uploadImageData(args.listing_id, fileArg(args.file), {
          shop: shopAlias,
          listingImageId: args.listing_image_id,
          rank: args.rank,
          overwrite: args.overwrite,
          isWatermarked: args.is_watermarked,
          altText: args.alt_text,
          backup: true,
        }));
      case 'etsy_image_delete':
        return exposedResult(await this.hub.deleteImage(args.listing_id, args.image_id, { shop: shopAlias, backup: true }));

      case 'etsy_videos_list':
        return exposedResult(await this.hub.listVideos(args.listing_id, { shop: shopAlias }));
      case 'etsy_video_get':
        return exposedResult(await this.hub.getVideo(args.listing_id, args.video_id, { shop: shopAlias }));
      case 'etsy_video_upload':
        if (!args.file && !args.video_id) fail('INVALID_ARGUMENT', 'file or video_id is required');
        return exposedResult(await this.hub.uploadVideo(args.listing_id, fileArg(args.file), { shop: shopAlias, videoId: args.video_id, name: args.name, isMultiVideo: args.is_multi_video, backup: true }));
      case 'etsy_video_delete':
        return exposedResult(await this.hub.deleteVideo(args.listing_id, args.video_id, { shop: shopAlias, backup: true }));

      case 'etsy_files_list':
        return exposedResult(await this.hub.listFiles(args.listing_id, { shop: shopAlias }));
      case 'etsy_file_get':
        return exposedResult(await this.hub.getFile(args.listing_id, args.listing_file_id, { shop: shopAlias }));
      case 'etsy_file_upload':
        if (!args.file && !args.listing_file_id) fail('INVALID_ARGUMENT', 'file or listing_file_id is required');
        return exposedResult(await this.hub.uploadFile(args.listing_id, fileArg(args.file), { shop: shopAlias, listingFileId: args.listing_file_id, name: args.name, rank: args.rank, backup: true }));
      case 'etsy_file_delete':
        return exposedResult(await this.hub.deleteFile(args.listing_id, args.listing_file_id, { shop: shopAlias, backup: true }));

      case 'etsy_listing_properties_get': { 
        const lid = need(args.listing_id, 'listing_id');
        const path = args.property_id
          ? `/application/listings/${lid}/properties/${need(args.property_id, 'property_id')}`
          : shopPath(`/listings/${lid}/properties`);
        return this.api(shopAlias, 'GET', path, { operation: 'mcp.listing.properties.get' });
      }
      case 'etsy_listing_property_write': { 
        const lid = need(args.listing_id, 'listing_id');
        const pid = need(args.property_id, 'property_id');
        const path = shopPath(`/listings/${lid}/properties/${pid}`);
        if (args.action === 'delete') return this.api(shopAlias, 'DELETE', path, { operation: 'mcp.listing.property.delete' });
        return this.api(shopAlias, 'PUT', path, { body: args.body || {}, operation: 'mcp.listing.property.set' });
      }
      case 'etsy_listing_translation_get':
        return this.api(shopAlias, 'GET', shopPath(`/listings/${need(args.listing_id, 'listing_id')}/translations/${encodeURIComponent(need(args.language, 'language'))}`), { operation: 'mcp.translation.get' });
      case 'etsy_listing_translation_write': { 
        const method = args.action === 'create' ? 'POST' : 'PUT';
        return this.api(shopAlias, method, shopPath(`/listings/${need(args.listing_id, 'listing_id')}/translations/${encodeURIComponent(need(args.language, 'language'))}`), { body: args.body, operation: `mcp.translation.${args.action}` });
      }
      case 'etsy_variation_images_get':
        return this.api(shopAlias, 'GET', shopPath(`/listings/${need(args.listing_id, 'listing_id')}/variation-images`), { operation: 'mcp.variation-images.get' });
      case 'etsy_variation_images_set':
        return this.api(shopAlias, 'POST', shopPath(`/listings/${need(args.listing_id, 'listing_id')}/variation-images`), { body: { variation_images: args.variation_images || [] }, operation: 'mcp.variation-images.set' });

      case 'etsy_shipping_profiles_list':
        return this.api(shopAlias, 'GET', shopPath('/shipping-profiles'), { operation: 'mcp.shipping-profiles.list' });
      case 'etsy_shipping_profile_get':
        return this.api(shopAlias, 'GET', shopPath(`/shipping-profiles/${need(args.shipping_profile_id, 'shipping_profile_id')}`), { operation: 'mcp.shipping-profile.get' });
      case 'etsy_shipping_profile_write': { 
        const action = need(args.action, 'action');
        const profile = args.shipping_profile_id ? need(args.shipping_profile_id, 'shipping_profile_id') : null;
        let method;
        let path;
        if (action === 'create_profile') { method = 'POST'; path = shopPath('/shipping-profiles'); }
        else if (action === 'update_profile') { method = 'PUT'; path = shopPath(`/shipping-profiles/${need(profile, 'shipping_profile_id')}`); }
        else if (action === 'delete_profile') { method = 'DELETE'; path = shopPath(`/shipping-profiles/${need(profile, 'shipping_profile_id')}`); }
        else if (action === 'create_destination') { method = 'POST'; path = shopPath(`/shipping-profiles/${need(profile, 'shipping_profile_id')}/destinations`); }
        else if (action === 'update_destination') { method = 'PUT'; path = shopPath(`/shipping-profiles/${need(profile, 'shipping_profile_id')}/destinations/${need(args.destination_id, 'destination_id')}`); }
        else if (action === 'delete_destination') { method = 'DELETE'; path = shopPath(`/shipping-profiles/${need(profile, 'shipping_profile_id')}/destinations/${need(args.destination_id, 'destination_id')}`); }
        else if (action === 'create_upgrade') { method = 'POST'; path = shopPath(`/shipping-profiles/${need(profile, 'shipping_profile_id')}/upgrades`); }
        else if (action === 'update_upgrade') { method = 'PUT'; path = shopPath(`/shipping-profiles/${need(profile, 'shipping_profile_id')}/upgrades/${need(args.upgrade_id, 'upgrade_id')}`); }
        else if (action === 'delete_upgrade') { method = 'DELETE'; path = shopPath(`/shipping-profiles/${need(profile, 'shipping_profile_id')}/upgrades/${need(args.upgrade_id, 'upgrade_id')}`); }
        else fail('INVALID_ARGUMENT', `Unsupported shipping profile action: ${action}`);
        return this.api(shopAlias, method, path, { body: method === 'DELETE' ? undefined : (args.body || {}), operation: `mcp.shipping.${action}` });
      }

      case 'etsy_processing_profiles_list':
        return this.api(shopAlias, 'GET', shopPath('/readiness-state-definitions'), { operation: 'mcp.processing.list' });
      case 'etsy_processing_profile_get':
        return this.api(shopAlias, 'GET', shopPath(`/readiness-state-definitions/${need(args.readiness_state_definition_id, 'readiness_state_definition_id')}`), { operation: 'mcp.processing.get' });
      case 'etsy_processing_profile_write': { 
        const action = need(args.action, 'action');
        const base = shopPath('/readiness-state-definitions');
        if (action === 'create') return this.api(shopAlias, 'POST', base, { body: args.body || {}, operation: 'mcp.processing.create' });
        const pid = need(args.readiness_state_definition_id, 'readiness_state_definition_id');
        if (action === 'delete') return this.api(shopAlias, 'DELETE', `${base}/${pid}`, { operation: 'mcp.processing.delete' });
        return this.api(shopAlias, 'PUT', `${base}/${pid}`, { body: args.body || {}, operation: 'mcp.processing.update' });
      }

      case 'etsy_return_policies_list':
        return this.api(shopAlias, 'GET', shopPath('/policies/return'), { operation: 'mcp.return-policy.list' });
      case 'etsy_return_policy_get':
        return this.api(shopAlias, 'GET', shopPath(`/policies/return/${need(args.return_policy_id, 'return_policy_id')}`), { operation: 'mcp.return-policy.get' });
      case 'etsy_return_policy_write': { 
        const action = need(args.action, 'action');
        const base = shopPath('/policies/return');
        if (action === 'create') return this.api(shopAlias, 'POST', base, { body: args.body || {}, operation: 'mcp.return-policy.create' });
        if (action === 'consolidate') return this.api(shopAlias, 'POST', `${base}/consolidate`, { body: args.body || {}, operation: 'mcp.return-policy.consolidate' });
        const rid = need(args.return_policy_id, 'return_policy_id');
        if (action === 'delete') return this.api(shopAlias, 'DELETE', `${base}/${rid}`, { operation: 'mcp.return-policy.delete' });
        return this.api(shopAlias, 'PUT', `${base}/${rid}`, { body: args.body || {}, operation: 'mcp.return-policy.update' });
      }

      case 'etsy_sections_list':
        return this.api(shopAlias, 'GET', shopPath('/sections'), { operation: 'mcp.sections.list' });
      case 'etsy_section_get':
        return this.api(shopAlias, 'GET', shopPath(`/sections/${need(args.shop_section_id, 'shop_section_id')}`), { operation: 'mcp.section.get' });
      case 'etsy_section_write': { 
        const action = need(args.action, 'action');
        const base = shopPath('/sections');
        if (action === 'create') return this.api(shopAlias, 'POST', base, { body: args.body || {}, operation: 'mcp.section.create' });
        const sid = need(args.shop_section_id, 'shop_section_id');
        if (action === 'delete') return this.api(shopAlias, 'DELETE', `${base}/${sid}`, { operation: 'mcp.section.delete' });
        return this.api(shopAlias, 'PUT', `${base}/${sid}`, { body: args.body || {}, operation: 'mcp.section.update' });
      }

      case 'etsy_taxonomy_get': { 
        const kind = args.taxonomy || 'seller';
        const base = `/application/${kind}-taxonomy/nodes`;
        const path = args.taxonomy_id ? `${base}/${need(args.taxonomy_id, 'taxonomy_id')}/properties` : base;
        return this.api(shopAlias, 'GET', path, { operation: `mcp.taxonomy.${kind}` });
      }
      case 'etsy_production_partners':
        return this.api(shopAlias, 'GET', shopPath('/production-partners'), { operation: 'mcp.production-partners.list' });
      case 'etsy_holiday_preferences_list':
        return this.api(shopAlias, 'GET', shopPath('/holiday-preferences'), { operation: 'mcp.holiday-preferences.list' });
      case 'etsy_holiday_preference_update':
        return this.api(shopAlias, 'PUT', shopPath(`/holiday-preferences/${need(args.holiday_id, 'holiday_id')}`), { body: args.body, operation: 'mcp.holiday-preference.update' });
      case 'etsy_shipping_carriers':
        return this.api(shopAlias, 'GET', '/application/shipping-carriers', { query: args.query, operation: 'mcp.shipping-carriers.list' });

      case 'etsy_user_me':
        return this.api(shopAlias, 'GET', '/application/users/me', { operation: 'mcp.user.me' });
      case 'etsy_user_get':
        return this.api(shopAlias, 'GET', `/application/users/${need(args.user_id, 'user_id')}`, { operation: 'mcp.user.get' });
      case 'etsy_user_addresses_list':
        return this.api(shopAlias, 'GET', '/application/user/addresses', { operation: 'mcp.user-addresses.list' });
      case 'etsy_user_address_get':
        return this.api(shopAlias, 'GET', `/application/user/addresses/${need(args.user_address_id, 'user_address_id')}`, { operation: 'mcp.user-address.get' });
      case 'etsy_user_address_delete':
        return this.api(shopAlias, 'DELETE', `/application/user/addresses/${need(args.user_address_id, 'user_address_id')}`, { operation: 'mcp.user-address.delete' });

      case 'etsy_request_read':
        return this.api(shopAlias, 'GET', args.path, { query: args.query, operation: 'mcp.raw.read' });
      case 'etsy_request_write':
        if (args.body !== undefined && args.form !== undefined) fail('INVALID_ARGUMENT', 'body and form are mutually exclusive');
        return this.api(shopAlias, args.method, args.path, { query: args.query, body: args.body, form: args.form, operation: 'mcp.raw.write' });
      case 'etsy_request_multipart':
        return this.api(shopAlias, args.method || 'POST', args.path, {
          query: args.query,
          form: args.form,
          files: (args.files || []).map(file => fileArg(file, file.field)),
          multipart: true,
          operation: 'mcp.raw.multipart',
        });
      default:
        throw Object.assign(new Error(`Unknown MCP tool: ${name}`), { code: 'METHOD_NOT_FOUND' });
    }
  }

  async handle(req, res) {
    if (req.method !== 'POST') {
      jsonRpcError(res, null, -32600, 'MCP requests must use POST.', 405);
      return;
    }

    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      const message = error?.code === 'MCP_BODY_TOO_LARGE' ? error.message : 'Parse error.';
      jsonRpcError(res, null, error?.code === 'MCP_BODY_TOO_LARGE' ? -32030 : -32700, message, error?.code === 'MCP_BODY_TOO_LARGE' ? 413 : 400);
      return;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      jsonRpcError(res, null, -32600, 'Invalid Request.');
      return;
    }

    const id = body.id;
    const method = typeof body.method === 'string' ? body.method : '';
    const methodHeader = String(req.headers['mcp-method'] || '');
    const protocolVersion = String(req.headers['mcp-protocol-version'] || '');
    if (body.jsonrpc !== '2.0' || !method) {
      jsonRpcError(res, id, -32600, 'Invalid Request.');
      return;
    }
    if (methodHeader && methodHeader !== method) {
      jsonRpcError(res, id, -32020, 'Mcp-Method header does not match JSON-RPC method.');
      return;
    }

    const modern = protocolVersion === MODERN_MCP_VERSION || method === 'server/discover';
    const params = body.params && typeof body.params === 'object' && !Array.isArray(body.params) ? body.params : {};

    try {
      if (method === 'server/discover') {
        sendJson(res, 200, {
          jsonrpc: '2.0',
          id,
          result: {
            resultType: 'complete',
            supportedVersions: [MODERN_MCP_VERSION],
            capabilities: { tools: {} },
            _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'etsy-shop-manager', version: '1.1.0' } },
            instructions: 'Private owner-controlled Etsy shop tools backed by the shared Etsy API Hub. The connector exposes typed tools for common shop workflows and full fallback access to every Etsy Open API /application/* endpoint through etsy_request_read, etsy_request_write, and etsy_request_multipart. Never claim a missing typed filter means the Etsy API is unavailable; use the raw fallback. Read current resources before substantial writes; prefer typed listing/media writes when available because they snapshot affected listing state.',
            ttlMs: 300000,
            cacheScope: 'private',
          },
        });
        return;
      }

      if (method === 'initialize') {
        sendJson(res, 200, { jsonrpc: '2.0', id, result: { protocolVersion: LEGACY_MCP_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'etsy-shop-manager', version: '1.1.0' } } });
        return;
      }

      if (method === 'notifications/initialized') {
        res.writeHead(202, { 'cache-control': 'no-store' });
        res.end();
        return;
      }

      if (method === 'ping') {
        sendJson(res, 200, { jsonrpc: '2.0', id, result: modern ? { resultType: 'complete' } : {} });
        return;
      }

      if (method === 'tools/list') {
        const result = { tools: ETSY_MCP_TOOLS };
        sendJson(res, 200, {
          jsonrpc: '2.0',
          id,
          result: modern ? { resultType: 'complete', ...result, ttlMs: 300000, cacheScope: 'private' } : result,
        });
        return;
      }

      if (method === 'tools/call') {
        const name = typeof params.name === 'string' ? params.name : '';
        const nameHeader = String(req.headers['mcp-name'] || '');
        if (!name) {
          jsonRpcError(res, id, -32602, 'Tool name is required.');
          return;
        }
        if (nameHeader && nameHeader !== name) {
          jsonRpcError(res, id, -32020, 'Mcp-Name header does not match tool name.');
          return;
        }
        const args = params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments : {};
        try {
          const value = await this.call(name, args);
          const result = toolResult(value);
          sendJson(res, 200, { jsonrpc: '2.0', id, result: modern ? { resultType: 'complete', ...result } : result });
        } catch (error) {
          const value = { ok: false, error: error?.code || 'etsy_error', message: error?.message || String(error), ...(error?.details ? { details: error.details } : {}) };
          const result = toolResult(value, true);
          sendJson(res, 200, { jsonrpc: '2.0', id, result: modern ? { resultType: 'complete', ...result } : result });
        }
        return;
      }

      jsonRpcError(res, id, -32601, `Method not found: ${method}.`);
    } catch (error) {
      jsonRpcError(res, id, -32603, error?.message || String(error), 500);
    }
  }
}
