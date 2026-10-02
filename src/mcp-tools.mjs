const SECURITY_SCHEMES = [{ type: 'oauth2', scopes: ['etsy'] }];

export const shopSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 80,
  description: 'Configured Etsy Hub shop alias. Omit to use the default shop.',
};

export const numericId = description => ({ type: 'string', pattern: '^[0-9]+$', description });

const queryValue = {
  oneOf: [
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' },
    { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] } },
  ],
};

export const querySchema = {
  type: 'object',
  additionalProperties: queryValue,
  description: 'Additional Etsy query parameters. Use this for new/rare parameters not exposed as named fields.',
};

export const anyJsonSchema = {
  oneOf: [
    { type: 'object', additionalProperties: true },
    { type: 'array' },
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' },
    { type: 'null' },
  ],
};

export const uploadSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 255, description: 'Filename sent to Etsy.' },
    mime_type: { type: 'string', minLength: 1, maxLength: 160, description: 'MIME type, for example image/jpeg or video/mp4.' },
    content_base64: { type: 'string', minLength: 1, description: 'Base64 or base64url encoded file bytes. Large uploads are subject to the private MCP request-size limit.' },
  },
  required: ['name', 'content_base64'],
};

export const rawMultipartFileSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    field: { type: 'string', minLength: 1, maxLength: 100, description: 'Multipart field name required by the Etsy endpoint, e.g. image, video, or file.' },
    name: { type: 'string', minLength: 1, maxLength: 255 },
    mime_type: { type: 'string', minLength: 1, maxLength: 160 },
    content_base64: { type: 'string', minLength: 1, description: 'Base64 or base64url encoded bytes.' },
  },
  required: ['field', 'name', 'content_base64'],
};

export function objectSchema(properties = {}, required = []) {
  return { type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) };
}

function tool(name, title, description, inputSchema, { readOnly = true, destructive = false, idempotent = true } = {}) {
  return {
    name,
    title,
    description,
    inputSchema,
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: destructive,
      idempotentHint: idempotent,
      openWorldHint: true,
    },
    securitySchemes: SECURITY_SCHEMES,
    _meta: { securitySchemes: SECURITY_SCHEMES },
  };
}

const limit = { type: 'integer', minimum: 1, maximum: 100, default: 25 };
const offset = { type: 'integer', minimum: 0, default: 0 };
const timestamp = description => ({ type: 'integer', minimum: 0, description });
const bodyObject = { type: 'object', additionalProperties: true, description: 'Request body fields accepted by the current Etsy endpoint.' };
const language = { type: 'string', minLength: 2, maxLength: 20, description: 'IETF language tag, e.g. en, es, uk.' };

export const ETSY_MCP_TOOLS = [
  tool(
    'etsy_capabilities',
    'Etsy connector capabilities',
    'Explain connector coverage. IMPORTANT: if a typed tool lacks a filter or endpoint, use etsy_request_read / etsy_request_write / etsy_request_multipart instead of claiming the Etsy connector cannot do it. The raw layer covers the full Etsy Open API /application/* surface.',
    objectSchema(),
  ),
  tool('etsy_shops', 'List Etsy shops', 'List configured Etsy Hub shop aliases and shop IDs. Never returns Etsy credentials.', objectSchema()),
  tool('etsy_openapi_ping', 'Ping Etsy Open API', 'Check connectivity from the configured Etsy application to Etsy Open API.', objectSchema({ shop: shopSchema })),
  tool('etsy_shop_get', 'Get shop', 'Read the configured Etsy shop resource.', objectSchema({ shop: shopSchema })),
  tool('etsy_shop_update', 'Update shop', 'Update shop title, announcement, sale messages, or additional policy text using Etsy form encoding.', objectSchema({ shop: shopSchema, changes: bodyObject }, ['changes']), { readOnly: false, idempotent: false }),
  tool('etsy_shop_search', 'Search Etsy shops', 'Search public Etsy shops by shop name.', objectSchema({ shop_name: { type: 'string', minLength: 1, maxLength: 255 }, limit, offset, shop: shopSchema }, ['shop_name'])),
  tool('etsy_shop_by_owner', 'Get shop by owner', 'Read the Etsy shop associated with a user ID.', objectSchema({ user_id: numericId('Etsy user ID.'), shop: shopSchema }, ['user_id'])),

  tool('etsy_listings_list', 'List Etsy listings', 'List shop listings by state with sorting and optional Etsy associations.', objectSchema({
    shop: shopSchema,
    state: { type: 'string', enum: ['active', 'inactive', 'sold_out', 'draft', 'removed', 'expired'], default: 'active' },
    limit,
    offset,
    sort_on: { type: 'string' },
    sort_order: { type: 'string', enum: ['up', 'down', 'asc', 'desc'] },
    includes: { type: 'array', items: { type: 'string', enum: ['Shipping', 'Shop', 'Images', 'User', 'Translations', 'Videos', 'Inventory', 'Personalization'] } },
  })),
  tool('etsy_listing_get', 'Get Etsy listing', 'Read one Etsy listing with images, videos, and personalization by default.', objectSchema({
    listing_id: numericId('Etsy listing ID.'),
    shop: shopSchema,
    includes: { type: 'array', items: { type: 'string' }, description: 'Override listing associations to include.' },
  }, ['listing_id'])),
  tool('etsy_listing_create', 'Create draft listing', 'Create an Etsy draft listing in the configured shop using the current Etsy request body schema.', objectSchema({ shop: shopSchema, listing: bodyObject }, ['listing']), { readOnly: false, idempotent: false }),
  tool('etsy_listing_update', 'Update Etsy listing', 'Update listing fields. The Hub snapshots listing, inventory, and personalization before the write.', objectSchema({ listing_id: numericId('Etsy listing ID.'), changes: bodyObject, shop: shopSchema }, ['listing_id', 'changes']), { readOnly: false, idempotent: false }),
  tool('etsy_listing_delete', 'Delete Etsy listing', 'Delete one listing. This is destructive and uses Etsy listings_d permission.', objectSchema({ listing_id: numericId('Etsy listing ID.'), shop: shopSchema }, ['listing_id']), { readOnly: false, destructive: true, idempotent: true }),
  tool('etsy_listings_batch_get', 'Get listings in batch', 'Read up to 100 Etsy listings by ID with optional associations, legacy processing-profile fields, currency conversion, and buyer-country pricing.', objectSchema({ listing_ids: { type: 'array', minItems: 1, maxItems: 100, items: numericId('Listing ID.') }, includes: { type: 'array', items: { type: 'string' } }, legacy: { type: 'boolean' }, currency: { type: 'string', minLength: 3, maxLength: 3 }, buyer_country: { type: 'string', minLength: 2, maxLength: 2 }, shop: shopSchema }, ['listing_ids'])),
  tool('etsy_listings_batch_inventory', 'Get listing inventory in batch', 'Read inventory for up to 100 listing IDs.', objectSchema({ listing_ids: { type: 'array', minItems: 1, maxItems: 100, items: numericId('Listing ID.') }, shop: shopSchema }, ['listing_ids'])),
  tool('etsy_listings_batch_shipping', 'Get listing shipping in batch', 'Read shipping profiles for up to 100 listing IDs.', objectSchema({ listing_ids: { type: 'array', minItems: 1, maxItems: 100, items: numericId('Listing ID.') }, shop: shopSchema }, ['listing_ids'])),
  tool('etsy_listing_product_get', 'Get listing product', 'Read one inventory product and its offerings/property values.', objectSchema({ listing_id: numericId('Listing ID.'), product_id: numericId('Product ID.'), legacy: { type: 'boolean' }, shop: shopSchema }, ['listing_id', 'product_id'])),
  tool('etsy_listing_offering_get', 'Get listing offering', 'Read one product offering for a listing.', objectSchema({ listing_id: numericId('Listing ID.'), product_id: numericId('Product ID.'), product_offering_id: numericId('Offering ID.'), legacy: { type: 'boolean' }, shop: shopSchema }, ['listing_id', 'product_id', 'product_offering_id'])),

  tool('etsy_orders_list', 'List Etsy orders', 'Read Etsy receipts/orders. Supports creation/update date windows, paid/shipped/delivered/canceled filters, sorting and pagination.', objectSchema({
    shop: shopSchema,
    min_created: timestamp('Earliest receipt creation time, Unix seconds.'),
    max_created: timestamp('Latest receipt creation time, Unix seconds.'),
    min_last_modified: timestamp('Earliest receipt last-modified time, Unix seconds.'),
    max_last_modified: timestamp('Latest receipt last-modified time, Unix seconds.'),
    limit,
    offset,
    sort_on: { type: 'string' },
    sort_order: { type: 'string', enum: ['up', 'down', 'asc', 'desc'] },
    was_paid: { type: 'boolean' },
    was_shipped: { type: 'boolean' },
    was_delivered: { type: 'boolean' },
    was_canceled: { type: 'boolean' },
    legacy: { type: 'boolean' },
  })),
  tool('etsy_order_get', 'Get Etsy order', 'Read one Etsy receipt/order by receipt ID.', objectSchema({ receipt_id: numericId('Etsy receipt ID.'), shop: shopSchema }, ['receipt_id'])),
  tool('etsy_order_update', 'Update Etsy order', 'Update an Etsy receipt using the current updateShopReceipt request body.', objectSchema({ receipt_id: numericId('Etsy receipt ID.'), body: bodyObject, shop: shopSchema, query: querySchema }, ['receipt_id', 'body']), { readOnly: false, idempotent: false }),
  tool('etsy_order_shipment_create', 'Create Etsy shipment', 'Submit tracking/shipment information for a receipt. Etsy may notify the buyer.', objectSchema({ receipt_id: numericId('Etsy receipt ID.'), shipment: bodyObject, shop: shopSchema, legacy: { type: 'boolean' } }, ['receipt_id', 'shipment']), { readOnly: false, idempotent: false }),
  tool('etsy_transactions_list', 'List Etsy transactions', 'Read shop transactions, or transactions for one listing or one receipt.', objectSchema({
    scope: { type: 'string', enum: ['shop', 'listing', 'receipt'], default: 'shop' },
    listing_id: numericId('Required when scope=listing.'),
    receipt_id: numericId('Required when scope=receipt.'),
    shop: shopSchema,
    limit,
    offset,
    query: querySchema,
  })),
  tool('etsy_transaction_get', 'Get Etsy transaction', 'Read one receipt transaction by transaction ID.', objectSchema({ transaction_id: numericId('Etsy transaction ID.'), shop: shopSchema }, ['transaction_id'])),

  tool('etsy_reviews_list', 'List Etsy reviews', 'Read reviews for the shop or for one listing, with optional date filters.', objectSchema({
    scope: { type: 'string', enum: ['shop', 'listing'], default: 'shop' },
    listing_id: numericId('Required when scope=listing.'),
    shop: shopSchema,
    limit,
    offset,
    min_created: timestamp('Earliest review creation time, Unix seconds.'),
    max_created: timestamp('Latest review creation time, Unix seconds.'),
  })),
  tool('etsy_payments_get', 'Get Etsy payments', 'Read Etsy Payments records by payment IDs.', objectSchema({ payment_ids: { type: 'array', minItems: 1, maxItems: 100, items: numericId('Payment ID.') }, shop: shopSchema }, ['payment_ids'])),
  tool('etsy_payment_by_receipt', 'Get payment by receipt', 'Read Etsy payment record for one receipt.', objectSchema({ receipt_id: numericId('Etsy receipt ID.'), shop: shopSchema }, ['receipt_id'])),
  tool('etsy_ledger_entries', 'List Etsy payment ledger', 'Read shop payment account ledger entries for a required Unix timestamp window.', objectSchema({ min_created: timestamp('Earliest ledger entry creation time, Unix seconds.'), max_created: timestamp('Latest ledger entry creation time, Unix seconds.'), limit, offset, shop: shopSchema }, ['min_created', 'max_created'])),
  tool('etsy_ledger_entry_get', 'Get Etsy ledger entry', 'Read one payment account ledger entry.', objectSchema({ ledger_entry_id: numericId('Ledger entry ID.'), shop: shopSchema }, ['ledger_entry_id'])),
  tool('etsy_payments_by_ledger_entries', 'Get payments by ledger entries', 'Read payment records associated with one or more ledger entry IDs.', objectSchema({ ledger_entry_ids: { type: 'array', minItems: 1, maxItems: 100, items: numericId('Ledger entry ID.') }, shop: shopSchema }, ['ledger_entry_ids'])),

  tool('etsy_personalization_get', 'Get personalization', 'Read personalization questions for one listing.', objectSchema({ listing_id: numericId('Etsy listing ID.'), shop: shopSchema }, ['listing_id'])),
  tool('etsy_personalization_set', 'Set personalization', 'Replace personalization questions. The Hub validates Etsy limits, preserves omitted add-on prices, and snapshots before writing.', objectSchema({ listing_id: numericId('Etsy listing ID.'), questions: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'object', additionalProperties: true } }, shop: shopSchema }, ['listing_id', 'questions']), { readOnly: false, idempotent: false }),
  tool('etsy_personalization_delete', 'Delete personalization', 'Delete personalization from a listing after a server-side snapshot.', objectSchema({ listing_id: numericId('Etsy listing ID.'), shop: shopSchema }, ['listing_id']), { readOnly: false, destructive: true, idempotent: true }),
  tool('etsy_inventory_get', 'Get inventory', 'Read products, offerings, prices, quantities, and variations for one listing.', objectSchema({ listing_id: numericId('Etsy listing ID.'), shop: shopSchema }, ['listing_id'])),
  tool('etsy_inventory_set', 'Set inventory', 'Replace listing inventory/variations. The Hub snapshots first and opts into Etsy current three-variation support.', objectSchema({ listing_id: numericId('Etsy listing ID.'), inventory: bodyObject, shop: shopSchema }, ['listing_id', 'inventory']), { readOnly: false, idempotent: false }),

  tool('etsy_images_list', 'List listing images', 'Read all listing images and their ranks/metadata.', objectSchema({ listing_id: numericId('Etsy listing ID.'), shop: shopSchema }, ['listing_id'])),
  tool('etsy_image_get', 'Get listing image', 'Read one listing image by image ID.', objectSchema({ listing_id: numericId('Etsy listing ID.'), image_id: numericId('Listing image ID.'), shop: shopSchema }, ['listing_id', 'image_id'])),
  tool('etsy_image_upload', 'Upload or assign listing image', 'Upload image bytes as base64/base64url or associate a previously uploaded/deleted image ID. Supports rank, overwrite, watermark flag and alt text.', objectSchema({
    listing_id: numericId('Etsy listing ID.'),
    shop: shopSchema,
    file: uploadSchema,
    listing_image_id: numericId('Existing listing image ID to associate instead of uploading bytes.'),
    rank: { type: 'integer', minimum: 1, maximum: 20 },
    overwrite: { type: 'boolean' },
    is_watermarked: { type: 'boolean' },
    alt_text: { type: 'string', maxLength: 500 },
  }, ['listing_id']), { readOnly: false, idempotent: false }),
  tool('etsy_image_delete', 'Delete listing image', 'Delete one Etsy listing image after a server-side snapshot.', objectSchema({ listing_id: numericId('Etsy listing ID.'), image_id: numericId('Listing image ID.'), shop: shopSchema }, ['listing_id', 'image_id']), { readOnly: false, destructive: true, idempotent: true }),

  tool('etsy_videos_list', 'List listing videos', 'Read all listing videos.', objectSchema({ listing_id: numericId('Etsy listing ID.'), shop: shopSchema }, ['listing_id'])),
  tool('etsy_video_get', 'Get listing video', 'Read one listing video by video ID.', objectSchema({ listing_id: numericId('Etsy listing ID.'), video_id: numericId('Listing video ID.'), shop: shopSchema }, ['listing_id', 'video_id'])),
  tool('etsy_video_upload', 'Upload or assign listing video', 'Upload video bytes as base64/base64url or associate an existing video ID. Etsy supports up to two listing videos when is_multi_video=true.', objectSchema({ listing_id: numericId('Etsy listing ID.'), shop: shopSchema, file: uploadSchema, video_id: numericId('Existing video ID to associate.'), name: { type: 'string', maxLength: 255 }, is_multi_video: { type: 'boolean' } }, ['listing_id']), { readOnly: false, idempotent: false }),
  tool('etsy_video_delete', 'Delete listing video', 'Delete one listing video after a server-side snapshot.', objectSchema({ listing_id: numericId('Etsy listing ID.'), video_id: numericId('Listing video ID.'), shop: shopSchema }, ['listing_id', 'video_id']), { readOnly: false, destructive: true, idempotent: true }),

  tool('etsy_files_list', 'List digital listing files', 'Read all files attached to one digital listing.', objectSchema({ listing_id: numericId('Etsy listing ID.'), shop: shopSchema }, ['listing_id'])),
  tool('etsy_file_get', 'Get digital listing file', 'Read metadata for one digital listing file.', objectSchema({ listing_id: numericId('Etsy listing ID.'), listing_file_id: numericId('Listing file ID.'), shop: shopSchema }, ['listing_id', 'listing_file_id'])),
  tool('etsy_file_upload', 'Upload or assign digital listing file', 'Upload digital file bytes as base64/base64url or associate an existing listing_file_id. Associating a file can convert a physical listing to digital.', objectSchema({ listing_id: numericId('Etsy listing ID.'), shop: shopSchema, file: uploadSchema, listing_file_id: numericId('Existing listing file ID to associate.'), name: { type: 'string', maxLength: 255 }, rank: { type: 'integer', minimum: 1 } }, ['listing_id']), { readOnly: false, idempotent: false }),
  tool('etsy_file_delete', 'Delete digital listing file', 'Delete one file from a digital listing. Deleting the final file can convert the listing to physical.', objectSchema({ listing_id: numericId('Etsy listing ID.'), listing_file_id: numericId('Listing file ID.'), shop: shopSchema }, ['listing_id', 'listing_file_id']), { readOnly: false, destructive: true, idempotent: true }),

  tool('etsy_listing_properties_get', 'Get listing properties', 'Read all listing properties or one property when property_id is supplied.', objectSchema({ listing_id: numericId('Etsy listing ID.'), property_id: numericId('Optional property ID.'), shop: shopSchema }, ['listing_id'])),
  tool('etsy_listing_property_write', 'Set or delete listing property', 'Create/update or delete a listing property.', objectSchema({ action: { type: 'string', enum: ['set', 'delete'] }, listing_id: numericId('Etsy listing ID.'), property_id: numericId('Property ID.'), body: bodyObject, shop: shopSchema }, ['action', 'listing_id', 'property_id']), { readOnly: false, destructive: true, idempotent: false }),
  tool('etsy_listing_translation_get', 'Get listing translation', 'Read one listing translation by language.', objectSchema({ listing_id: numericId('Etsy listing ID.'), language, shop: shopSchema }, ['listing_id', 'language'])),
  tool('etsy_listing_translation_write', 'Create or update listing translation', 'Create or update a listing translation.', objectSchema({ action: { type: 'string', enum: ['create', 'update'] }, listing_id: numericId('Etsy listing ID.'), language, body: bodyObject, shop: shopSchema }, ['action', 'listing_id', 'language', 'body']), { readOnly: false, idempotent: false }),
  tool('etsy_variation_images_get', 'Get variation images', 'Read listing variation-image mappings.', objectSchema({ listing_id: numericId('Etsy listing ID.'), shop: shopSchema }, ['listing_id'])),
  tool('etsy_variation_images_set', 'Set variation images', 'Replace/create listing variation-image mappings.', objectSchema({ listing_id: numericId('Etsy listing ID.'), variation_images: { type: 'array', items: { type: 'object', additionalProperties: true } }, shop: shopSchema }, ['listing_id', 'variation_images']), { readOnly: false, idempotent: false }),

  tool('etsy_shipping_profiles_list', 'List shipping profiles', 'Read all shipping profiles for the shop.', objectSchema({ shop: shopSchema })),
  tool('etsy_shipping_profile_get', 'Get shipping profile', 'Read one shipping profile including destinations and upgrades.', objectSchema({ shipping_profile_id: numericId('Shipping profile ID.'), shop: shopSchema }, ['shipping_profile_id'])),
  tool('etsy_shipping_profile_write', 'Create/update/delete shipping profile resource', 'Manage shipping profiles, destinations, or upgrades. action determines the endpoint; body uses current Etsy schema.', objectSchema({
    action: { type: 'string', enum: ['create_profile', 'update_profile', 'delete_profile', 'create_destination', 'update_destination', 'delete_destination', 'create_upgrade', 'update_upgrade', 'delete_upgrade'] },
    shipping_profile_id: numericId('Required except create_profile.'),
    destination_id: numericId('Required for update/delete destination.'),
    upgrade_id: numericId('Required for update/delete upgrade.'),
    body: bodyObject,
    shop: shopSchema,
  }, ['action']), { readOnly: false, destructive: true, idempotent: false }),

  tool('etsy_processing_profiles_list', 'List processing profiles', 'Read shop readiness/processing profile definitions.', objectSchema({ shop: shopSchema })),
  tool('etsy_processing_profile_get', 'Get processing profile', 'Read one readiness/processing profile definition.', objectSchema({ readiness_state_definition_id: numericId('Processing profile/readiness definition ID.'), shop: shopSchema }, ['readiness_state_definition_id'])),
  tool('etsy_processing_profile_write', 'Create/update/delete processing profile', 'Manage Etsy readiness/processing profile definitions.', objectSchema({ action: { type: 'string', enum: ['create', 'update', 'delete'] }, readiness_state_definition_id: numericId('Required for update/delete.'), body: bodyObject, shop: shopSchema }, ['action']), { readOnly: false, destructive: true, idempotent: false }),

  tool('etsy_return_policies_list', 'List return policies', 'Read shop return policies.', objectSchema({ shop: shopSchema })),
  tool('etsy_return_policy_get', 'Get return policy', 'Read one return policy.', objectSchema({ return_policy_id: numericId('Return policy ID.'), shop: shopSchema }, ['return_policy_id'])),
  tool('etsy_return_policy_write', 'Create/update/delete/consolidate return policy', 'Manage shop return policies. consolidate moves listings from a source policy according to Etsy request body.', objectSchema({ action: { type: 'string', enum: ['create', 'update', 'delete', 'consolidate'] }, return_policy_id: numericId('Required for update/delete.'), body: bodyObject, shop: shopSchema }, ['action']), { readOnly: false, destructive: true, idempotent: false }),

  tool('etsy_sections_list', 'List shop sections', 'Read shop sections.', objectSchema({ shop: shopSchema })),
  tool('etsy_section_get', 'Get shop section', 'Read one shop section.', objectSchema({ shop_section_id: numericId('Shop section ID.'), shop: shopSchema }, ['shop_section_id'])),
  tool('etsy_section_write', 'Create/update/delete shop section', 'Manage Etsy shop sections.', objectSchema({ action: { type: 'string', enum: ['create', 'update', 'delete'] }, shop_section_id: numericId('Required for update/delete.'), body: bodyObject, shop: shopSchema }, ['action']), { readOnly: false, destructive: true, idempotent: false }),

  tool('etsy_taxonomy_get', 'Get Etsy taxonomy', 'Read seller/buyer taxonomy tree, or properties for a taxonomy node.', objectSchema({ taxonomy: { type: 'string', enum: ['seller', 'buyer'], default: 'seller' }, taxonomy_id: numericId('If provided, return properties for this taxonomy node.'), shop: shopSchema })),
  tool('etsy_production_partners', 'List production partners', 'Read production partners configured for the shop.', objectSchema({ shop: shopSchema })),
  tool('etsy_holiday_preferences_list', 'List holiday preferences', 'Read shop holiday processing preferences.', objectSchema({ shop: shopSchema })),
  tool('etsy_holiday_preference_update', 'Update holiday preference', 'Update whether the seller processes orders on one holiday.', objectSchema({ holiday_id: numericId('Holiday ID.'), body: bodyObject, shop: shopSchema }, ['holiday_id', 'body']), { readOnly: false, idempotent: false }),
  tool('etsy_shipping_carriers', 'List shipping carriers', 'Read Etsy shipping carriers and mail classes.', objectSchema({ query: querySchema })),

  tool('etsy_user_me', 'Get current Etsy user', 'Read basic info for the authenticated Etsy user.', objectSchema({ shop: shopSchema })),
  tool('etsy_user_get', 'Get Etsy user', 'Read one Etsy user profile by user ID, subject to token permissions.', objectSchema({ user_id: numericId('Etsy user ID.'), shop: shopSchema }, ['user_id'])),
  tool('etsy_user_addresses_list', 'List Etsy user addresses', 'Read addresses for the authenticated user, subject to address_r scope.', objectSchema({ shop: shopSchema })),
  tool('etsy_user_address_get', 'Get Etsy user address', 'Read one authenticated-user address.', objectSchema({ user_address_id: numericId('User address ID.'), shop: shopSchema }, ['user_address_id'])),
  tool('etsy_user_address_delete', 'Delete Etsy user address', 'Delete one authenticated-user address, subject to address_w scope.', objectSchema({ user_address_id: numericId('User address ID.'), shop: shopSchema }, ['user_address_id']), { readOnly: false, destructive: true, idempotent: true }),

  tool('etsy_request_read', 'Read any Etsy API resource', 'GET any Etsy Open API v3 /application/* endpoint. This is the full-coverage fallback when a typed tool lacks an endpoint or filter.', objectSchema({ path: { type: 'string', pattern: '^/application/', description: 'Etsy v3 path beginning with /application/.' }, shop: shopSchema, query: querySchema }, ['path'])),
  tool('etsy_request_write', 'Write any Etsy JSON/form resource', 'POST, PUT, PATCH, or DELETE any Etsy Open API v3 /application/* endpoint using JSON body or URL-encoded form. Raw writes do not infer snapshots.', objectSchema({ method: { type: 'string', enum: ['POST', 'PUT', 'PATCH', 'DELETE'] }, path: { type: 'string', pattern: '^/application/' }, shop: shopSchema, query: querySchema, body: anyJsonSchema, form: { type: 'object', additionalProperties: queryValue } }, ['method', 'path']), { readOnly: false, destructive: true, idempotent: false }),
  tool('etsy_request_multipart', 'Call any Etsy multipart endpoint', 'POST/PUT/PATCH any Etsy /application/* multipart/form-data endpoint with arbitrary form fields and one or more base64 files. This provides generic coverage for present/future upload endpoints.', objectSchema({ method: { type: 'string', enum: ['POST', 'PUT', 'PATCH'], default: 'POST' }, path: { type: 'string', pattern: '^/application/' }, shop: shopSchema, query: querySchema, form: { type: 'object', additionalProperties: queryValue }, files: { type: 'array', minItems: 1, maxItems: 10, items: rawMultipartFileSchema } }, ['path', 'files']), { readOnly: false, idempotent: false }),
];
