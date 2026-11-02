const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export function isLoopbackHost(host) {
  return LOOPBACK.has(String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, ''));
}

export function assertSafeServerConfig(config, internalToken) {
  if (!isLoopbackHost(config?.server?.host) && !internalToken) {
    throw new Error('Refusing non-loopback Etsy API server without a nonempty bearer token');
  }
  const publicBase = config?.server?.public_base_url;
  if (publicBase) {
    const url = new URL(publicBase);
    if (url.protocol !== 'https:' && !isLoopbackHost(url.hostname)) {
      throw new Error('Remote MCP public_base_url must use HTTPS');
    }
  }
}
