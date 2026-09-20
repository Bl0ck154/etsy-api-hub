import test from 'node:test';
import assert from 'node:assert/strict';

import { EtsyHub } from '../src/hub.mjs';

test('EtsyHub accepts an external token store factory', async () => {
  let factoryCalls = 0;
  const tokenStore = {
    async accessToken() { return 'access'; },
    async apiKeyHeader() { return 'key:secret'; },
    async refresh() { return 'refreshed'; },
  };
  const hub = new EtsyHub({
    default_shop: 'main',
    shops: { main: { shop_id: '12345678', credential_file: '/unused.json' } },
    audit_file: null,
  }, {
    tokenStoreFactory({ shop }) {
      factoryCalls += 1;
      assert.equal(shop.alias, 'main');
      return tokenStore;
    },
    fetchImpl: async request => {
      assert.match(String(request), /\/application\/listings\/123$/);
      return new Response(JSON.stringify({ listing_id: 123 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const result = await hub.request({ apiPath: '/application/listings/123' });
  assert.equal(result.data.listing_id, 123);
  assert.equal(factoryCalls, 1);
});
