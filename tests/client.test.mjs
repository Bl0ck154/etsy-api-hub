import test from 'node:test';
import assert from 'node:assert/strict';
import { EtsyClient, normalizeApiPath } from '../src/client.mjs';

test('accepts Etsy application paths', () => {
  assert.equal(normalizeApiPath('/application/listings/123'), '/application/listings/123');
  assert.equal(normalizeApiPath('/v3/application/listings/123'), '/application/listings/123');
  assert.equal(normalizeApiPath('application/listings/123'), '/application/listings/123');
});

test('rejects arbitrary URLs and non-application paths', () => {
  assert.throws(() => normalizeApiPath('https://evil.example/x'), /not a full URL/);
  assert.throws(() => normalizeApiPath('/public/oauth/token'), /Only Etsy/);
  assert.throws(() => normalizeApiPath('/application/../public/x'), /traversal/);
});


test('multipart request accepts base64 bytes without a server-side file path', async () => {
  let seen;
  const client = new EtsyClient({
    tokenStore: {
      async accessToken() { return 'access'; },
      async apiKeyHeader() { return 'key:secret'; },
      async refresh() { return 'refreshed'; },
    },
    fetchImpl: async (url, options) => {
      seen = { url: String(url), options };
      return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'content-type': 'application/json' } });
    },
  });
  await client.request({
    method: 'POST',
    apiPath: '/application/example/upload',
    multipart: true,
    form: { rank: 2 },
    files: [{ field: 'image', name: 'tiny.jpg', mime_type: 'image/jpeg', content_base64: 'YWJj' }],
  });
  assert.ok(seen.options.body instanceof FormData);
  assert.equal(seen.options.body.get('rank'), '2');
  const file = seen.options.body.get('image');
  assert.equal(file.name, 'tiny.jpg');
  assert.equal(file.type, 'image/jpeg');
  assert.equal(Buffer.from(await file.arrayBuffer()).toString(), 'abc');
  assert.equal(seen.options.headers['Content-Type'], undefined);
});

test('multipart form can associate an existing Etsy media id with no binary file', async () => {
  let seenBody;
  const client = new EtsyClient({
    tokenStore: {
      async accessToken() { return 'access'; },
      async apiKeyHeader() { return 'key:secret'; },
      async refresh() { return 'refreshed'; },
    },
    fetchImpl: async (_url, options) => {
      seenBody = options.body;
      return new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } });
    },
  });
  await client.request({ method: 'POST', apiPath: '/application/example/upload', multipart: true, form: { listing_image_id: 123 } });
  assert.ok(seenBody instanceof FormData);
  assert.equal(seenBody.get('listing_image_id'), '123');
});
