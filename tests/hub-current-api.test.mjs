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
