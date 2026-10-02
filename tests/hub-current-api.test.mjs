import test from 'node:test';
import assert from 'node:assert/strict';

import { EtsyHub } from '../src/hub.mjs';

function tokenStore() {
  return {
    async accessToken() { return 'access'; },
    async apiKeyHeader() { return 'key:secret'; },
    async refresh() { return 'refreshed'; },
  };
}

function config() {
  return {
    default_shop: 'main',
    shops: { main: { shop_id: '12345678', credential_file: '/unused.json' } },
    audit_file: null,
    backup_dir: '/tmp/etsy-hub-test-backups',
  };
}

test('invalid personalization fails before any Etsy request', async () => {
  let fetchCalls = 0;
  const hub = new EtsyHub(config(), {
    tokenStoreFactory: tokenStore,
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  await assert.rejects(
    hub.setPersonalization(123, [{
      question_text: 'Your Script',
      instructions: 'x'.repeat(121),
      question_type: 'text_input',
      required: true,
      max_allowed_characters: 1024,
    }], { backup: false }),
    /120 characters/,
  );
  assert.equal(fetchCalls, 0);
});

test('inventory writes opt in to three-variation support', async () => {
  let seenUrl = '';
  const hub = new EtsyHub(config(), {
    tokenStoreFactory: tokenStore,
    fetchImpl: async request => {
      seenUrl = String(request);
      return new Response(JSON.stringify({ products: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await hub.setInventory(123, { products: [] }, { backup: false });
  const url = new URL(seenUrl);
  assert.equal(url.searchParams.get('legacy'), 'false');
  assert.equal(url.searchParams.get('max_variations_supported'), '3');
});


test('listing list uses current Etsy shop listings endpoint with state as query', async () => {
  let seenUrl = '';
  const hub = new EtsyHub(config(), {
    tokenStoreFactory: tokenStore,
    fetchImpl: async request => {
      seenUrl = String(request);
      return new Response(JSON.stringify({ count: 0, results: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  await hub.listListings({ state: 'inactive', limit: 11, offset: 4, includes: ['Images', 'Inventory'] });
  const url = new URL(seenUrl);
  assert.equal(url.pathname, '/v3/application/shops/12345678/listings');
  assert.equal(url.searchParams.get('state'), 'inactive');
  assert.equal(url.searchParams.get('limit'), '11');
  assert.equal(url.searchParams.get('offset'), '4');
  assert.equal(url.searchParams.get('includes'), 'Images,Inventory');
});

test('receipt list forwards current Etsy date and lifecycle filters', async () => {
  let seenUrl = '';
  const hub = new EtsyHub(config(), {
    tokenStoreFactory: tokenStore,
    fetchImpl: async request => {
      seenUrl = String(request);
      return new Response(JSON.stringify({ count: 0, results: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  await hub.listReceipts({
    minCreated: 100,
    maxCreated: 200,
    minLastModified: 110,
    maxLastModified: 210,
    sortOn: 'created',
    sortOrder: 'down',
    wasPaid: true,
    wasShipped: false,
    wasDelivered: false,
    wasCanceled: false,
    legacy: false,
  });
  const q = new URL(seenUrl).searchParams;
  assert.equal(q.get('min_created'), '100');
  assert.equal(q.get('max_created'), '200');
  assert.equal(q.get('min_last_modified'), '110');
  assert.equal(q.get('max_last_modified'), '210');
  assert.equal(q.get('sort_on'), 'created');
  assert.equal(q.get('sort_order'), 'down');
  assert.equal(q.get('was_paid'), 'true');
  assert.equal(q.get('was_shipped'), 'false');
  assert.equal(q.get('was_delivered'), 'false');
  assert.equal(q.get('was_canceled'), 'false');
  assert.equal(q.get('legacy'), 'false');
});
