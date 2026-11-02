import { ETSY_MCP_TOOLS } from './mcp-tools.mjs';

export function localMcpTools({ readOnly = false } = {}) {
  return ETSY_MCP_TOOLS
    .filter(tool => !readOnly || tool.annotations?.readOnlyHint === true)
    .map(({ securitySchemes, _meta, ...tool }) => tool);
}

export function createStdioHandler(adapter, { readOnly = false } = {}) {
  return async function handle(request) {
    const id = request?.id ?? null;
    const error = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
    if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      return error(-32600, 'Invalid Request');
    }
    const method = request.method;
    if (method.startsWith('notifications/')) return null;
    if (request.id === undefined) return null;
    if (method === 'initialize') {
      return { jsonrpc: '2.0', id, result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'etsy-seller-mcp-hub', version: '0.4.0' }
      }};
    }
    if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
    if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: localMcpTools({ readOnly }) } };
    if (method === 'tools/call') {
      const name = request.params?.name;
      if (typeof name !== 'string' || !name) return error(-32602, 'Tool name required');
      if (!localMcpTools({ readOnly }).some(tool => tool.name === name)) return error(-32602, 'Unknown tool');
      try {
        const args = request.params?.arguments || {};
        if (typeof args !== 'object' || Array.isArray(args)) return error(-32602, 'Invalid arguments');
        const value = await adapter.call(name, args);
        return { jsonrpc: '2.0', id, result: {
          content: [{ type: 'text', text: JSON.stringify(value) }],
          structuredContent: value && typeof value === 'object' ? value : { value }
        }};
      } catch (e) {
        return { jsonrpc: '2.0', id, result: {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify({ error: e?.code || 'etsy_error', message: e?.message || String(e) }) }]
        }};
      }
    }
    return error(-32601, 'Method not found');
  };
}
