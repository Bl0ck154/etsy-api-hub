import { publicConfig } from './config.mjs';

export const MODERN_MCP_VERSION = '2026-07-28';
const LEGACY_MCP_VERSION = '2025-06-18';
const SECURITY_SCHEMES = [{ type: 'oauth2', scopes: ['etsy'] }];

const shop = {
  type: 'string',
  minLength: 1,
  maxLength: 80,
  description: 'Configured Etsy Hub shop alias. Omit to use the default shop.',
};
const numericId = description => ({ type: 'string', pattern: '^[0-9]+$', description });
const queryValue = {
  oneOf: [
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' },
    { type: 'array', items: { type: 'string' } },
  ],
};
const query = { type: 'object', additionalProperties: queryValue };
const anyJson = {
  oneOf: [
    { type: 'object', additionalProperties: true },
    { type: 'array' },
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' },
    { type: 'null' },
  ],
};

function objectSchema(properties = {}, required = []) {
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

export const ETSY_MCP_TOOLS = [
  tool('etsy_shops', 'List Etsy shops', 'List configured Etsy Hub shop aliases and shop IDs. Never returns Etsy credentials.', objectSchema()),
  tool('etsy_listing_get', 'Get Etsy listing', 'Read one Etsy listing with images, videos, and personalization.', objectSchema({ listing_id: numericId('Etsy listing ID.'), shop }, ['listing_id'])),
  tool('etsy_listings_list', 'List Etsy listings', 'List listings in a shop by state.', objectSchema({ shop, state: { type: 'string', default: 'active' }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 }, offset: { type: 'integer', minimum: 0, default: 0 } })),
  tool('etsy_orders_list', 'List Etsy orders', 'Read Etsy receipts/orders, including transactions.', objectSchema({ shop, limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 }, offset: { type: 'integer', minimum: 0, default: 0 }, was_paid: { type: 'boolean' }, was_shipped: { type: 'boolean' } })),
  tool('etsy_order_get', 'Get Etsy order', 'Read one Etsy receipt/order by receipt ID.', objectSchema({ receipt_id: numericId('Etsy receipt ID.'), shop }, ['receipt_id'])),
  tool('etsy_personalization_get', 'Get personalization', 'Read personalization questions for one listing.', objectSchema({ listing_id: numericId('Etsy listing ID.'), shop }, ['listing_id'])),
  tool('etsy_inventory_get', 'Get inventory', 'Read products, offerings, prices, quantities, and variations for one listing.', objectSchema({ listing_id: numericId('Etsy listing ID.'), shop }, ['listing_id'])),
  tool('etsy_images_list', 'List listing images', 'Read all listing images and their ranks/metadata.', objectSchema({ listing_id: numericId('Etsy listing ID.'), shop }, ['listing_id'])),
  tool('etsy_request_read', 'Read Etsy API resource', 'GET any Etsy Open API v3 /application/* resource through the shared Hub. Use this when no typed read tool covers the endpoint.', objectSchema({ path: { type: 'string', pattern: '^/application/', description: 'Etsy v3 path beginning with /application/.' }, shop, query }, ['path'])),
  tool('etsy_listing_update', 'Update Etsy listing', 'Update listing fields through the Hub. The Hub snapshots listing, inventory, and personalization before the write.', objectSchema({ listing_id: numericId('Etsy listing ID.'), changes: { type: 'object', additionalProperties: true }, shop }, ['listing_id', 'changes']), { readOnly: false, idempotent: false }),
  tool('etsy_personalization_set', 'Set personalization', 'Replace personalization questions for a listing. The Hub validates Etsy limits, preserves omitted existing add-on prices, and snapshots before writing.', objectSchema({ listing_id: numericId('Etsy listing ID.'), questions: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'object', additionalProperties: true } }, shop }, ['listing_id', 'questions']), { readOnly: false, idempotent: false }),
  tool('etsy_personalization_delete', 'Delete personalization', 'Delete personalization from a listing after a server-side snapshot.', objectSchema({ listing_id: numericId('Etsy listing ID.'), shop }, ['listing_id']), { readOnly: false, destructive: true, idempotent: true }),
  tool('etsy_inventory_set', 'Set inventory', 'Replace listing inventory/variations. The Hub snapshots the listing first and supports Etsy current three-variation mode.', objectSchema({ listing_id: numericId('Etsy listing ID.'), inventory: { type: 'object', additionalProperties: true }, shop }, ['listing_id', 'inventory']), { readOnly: false, idempotent: false }),
  tool('etsy_image_delete', 'Delete listing image', 'Delete one Etsy listing image after a server-side snapshot.', objectSchema({ listing_id: numericId('Etsy listing ID.'), image_id: numericId('Etsy listing image ID.'), shop }, ['listing_id', 'image_id']), { readOnly: false, destructive: true, idempotent: true }),
  tool('etsy_request_write', 'Write Etsy API resource', 'POST, PUT, PATCH, or DELETE any Etsy Open API v3 /application/* resource. This raw escape hatch does not infer a backup; prefer typed write tools when available.', objectSchema({ method: { type: 'string', enum: ['POST', 'PUT', 'PATCH', 'DELETE'] }, path: { type: 'string', pattern: '^/application/' }, shop, query, body: anyJson }, ['method', 'path']), { readOnly: false, destructive: true, idempotent: false }),
];

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
    if (total > 1024 * 1024) throw new Error('MCP request body too large');
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

export class EtsyMcpAdapter {
  constructor(hub, config) {
    this.hub = hub;
    this.config = config;
  }

  async call(name, args = {}) {
    const shopAlias = args.shop || null;
    switch (name) {
      case 'etsy_shops':
        return publicConfig(this.config);
      case 'etsy_listing_get':
        return exposedResult(await this.hub.getListing(args.listing_id, { shop: shopAlias }));
      case 'etsy_listings_list':
        return exposedResult(await this.hub.listListings({ shop: shopAlias, state: args.state || 'active', limit: Number(args.limit || 25), offset: Number(args.offset || 0) }));
      case 'etsy_orders_list':
        return exposedResult(await this.hub.listReceipts({ shop: shopAlias, limit: Number(args.limit || 25), offset: Number(args.offset || 0), wasPaid: args.was_paid, wasShipped: args.was_shipped }));
      case 'etsy_order_get':
        return exposedResult(await this.hub.getReceipt(args.receipt_id, { shop: shopAlias }));
      case 'etsy_personalization_get':
        return exposedResult(await this.hub.getPersonalization(args.listing_id, { shop: shopAlias }));
      case 'etsy_inventory_get':
        return exposedResult(await this.hub.getInventory(args.listing_id, { shop: shopAlias }));
      case 'etsy_images_list':
        return exposedResult(await this.hub.listImages(args.listing_id, { shop: shopAlias }));
      case 'etsy_request_read':
        return exposedResult(await this.hub.request({ shop: shopAlias, method: 'GET', apiPath: args.path, query: args.query, operation: 'mcp.read' }));
      case 'etsy_listing_update':
        return exposedResult(await this.hub.updateListing(args.listing_id, args.changes || {}, { shop: shopAlias, backup: true }));
      case 'etsy_personalization_set':
        return exposedResult(await this.hub.setPersonalization(args.listing_id, args.questions, { shop: shopAlias, backup: true }));
      case 'etsy_personalization_delete':
        return exposedResult(await this.hub.deletePersonalization(args.listing_id, { shop: shopAlias, backup: true }));
      case 'etsy_inventory_set':
        return exposedResult(await this.hub.setInventory(args.listing_id, args.inventory, { shop: shopAlias, backup: true }));
      case 'etsy_image_delete':
        return exposedResult(await this.hub.deleteImage(args.listing_id, args.image_id, { shop: shopAlias, backup: true }));
      case 'etsy_request_write':
        return exposedResult(await this.hub.request({ shop: shopAlias, method: args.method, apiPath: args.path, query: args.query, body: args.body, operation: 'mcp.write' }));
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
    } catch {
      jsonRpcError(res, null, -32700, 'Parse error.');
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
            _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'etsy-shop-manager', version: '1.0.0' } },
            instructions: 'Private owner-controlled Etsy shop tools backed by the shared Etsy API Hub. Read before substantial writes. Prefer typed write tools because they snapshot affected listing state; use raw write only when Etsy has no typed Hub operation.',
            ttlMs: 300000,
            cacheScope: 'private',
          },
        });
        return;
      }

      if (method === 'initialize') {
        sendJson(res, 200, { jsonrpc: '2.0', id, result: { protocolVersion: LEGACY_MCP_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'etsy-shop-manager', version: '1.0.0' } } });
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
