import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, publicConfig } from '../src/config.mjs';

test('loads shop config without exposing credential path via publicConfig', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'etsy-hub-test-'));
  const file = path.join(dir, 'config.json');
  await fs.writeFile(file, JSON.stringify({
    default_shop: 'main',
    shops: { main: { shop_id: '123', credential_file: '/secret/token.json' } },
  }));
  const config = await loadConfig(file);
  assert.equal(config.default_shop, 'main');
  assert.deepEqual(publicConfig(config).shops.main, { shop_id: '123' });
  assert.equal(JSON.stringify(publicConfig(config)).includes('/secret/token.json'), false);
});
