#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import readline from 'node:readline';
import { loadConfig } from '../src/config.mjs';
import { EtsyHub } from '../src/hub.mjs';
import { EtsyMcpAdapter } from '../src/mcp-adapter.mjs';
import { createStdioHandler } from '../src/stdio-handler.mjs';

async function main() {
  const config = await loadConfig();
  let tokenStoreFactory = null;
  const providerModule = String(process.env.ETSY_HUB_TOKEN_PROVIDER_MODULE || '').trim();
  if (providerModule) {
    const provider = await import(pathToFileURL(path.resolve(providerModule)).href);
    if (typeof provider.createTokenStore !== 'function') throw new Error('Token provider must export createTokenStore');
    tokenStoreFactory = args => provider.createTokenStore(args);
  }
  const hub = new EtsyHub(config, { tokenStoreFactory });
  const handle = createStdioHandler(new EtsyMcpAdapter(hub, config), { readOnly: process.env.ETSY_MCP_READ_ONLY === '1' });
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    let response;
    try { response = await handle(JSON.parse(line)); }
    catch { response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }; }
    if (response) process.stdout.write(JSON.stringify(response) + '\n');
  }
}
main().catch(error => {
  process.stderr.write('Failed to start Etsy MCP: ' + error.message + '\n');
  process.exitCode = 1;
});
