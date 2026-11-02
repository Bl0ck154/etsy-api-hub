import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';

test('npm manifest and official MCP Registry metadata agree', async () => {
  const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const registry = JSON.parse(await fs.readFile(new URL('../server.json', import.meta.url), 'utf8'));
  assert.equal(pkg.private, undefined);
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.name, 'etsy-seller-mcp-hub');
  assert.equal(registry.title, 'Etsy Seller MCP Hub');
  assert.equal(registry.name, 'io.github.bl0ck154/etsy-seller-mcp-hub');
  assert.equal(pkg.mcpName, registry.name);
  assert.equal(pkg.version, registry.version);
  assert.equal(registry.packages.length, 1);
  assert.equal(registry.packages[0].registryType, 'npm');
  assert.equal(registry.packages[0].identifier, pkg.name);
  assert.equal(registry.packages[0].version, pkg.version);
  assert.equal(registry.packages[0].transport.type, 'stdio');
  assert.equal(pkg.bin['etsy-mcp'], './bin/etsy-mcp.mjs');
  assert.equal(registry.packages[0].environmentVariables[0].name, 'ETSY_HUB_CONFIG');
});
