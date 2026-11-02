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

function uploadTestClient(maxUploadBytes, state) {
  return new EtsyClient({
    maxUploadBytes,
    tokenStore: {
      accessToken: async () => 'access',
      apiKeyHeader: async () => 'key:secret',
      refresh: async () => 'fresh'
    },
    fetchImpl: async () => { state.calls++; return new Response('{}', { status: 200 }); }
  });
}

test('upload size setting validates integer bounds before requests', () => {
  for (const limit of [0, -1, NaN, 1.5, Infinity, 193 * 1024 * 1024]) {
    assert.throws(() => uploadTestClient(limit, { calls: 0 }), /maxUploadBytes/);
  }
});
test('base64 multipart upload rejects oversized decoded content before fetch', async () => {
  const state = { calls: 0 };
  const client = uploadTestClient(4, state);
  await assert.rejects(
    client.request({ method: 'POST', apiPath: '/application/example/upload', files: [
      { field: 'image', name: 'a.png', content_base64: Buffer.alloc(5).toString('base64') }
    ] }),
    /size limit/
  );
  assert.equal(state.calls, 0);
});
test('encoded multipart payload rejects excessive whitespace before decoding', async () => {
  const state = { calls: 0 };
  const client = uploadTestClient(4, state);
  await assert.rejects(
    client.request({ method: 'POST', apiPath: '/application/example/upload', files: [
      { field: 'file', name: 'a.bin', content_base64: ' '.repeat(5000) + 'YQ==' }
    ] }),
    /size limit/
  );
  assert.equal(state.calls, 0);
});
test('multipart Uint8Array cannot exceed the configured size limit', async () => {
  const state = { calls: 0 };
  const client = uploadTestClient(4, state);
  await assert.rejects(client.request({
    method: 'POST', apiPath: '/application/example/upload',
    files: [{ field: 'file', name: 'a.bin', bytes: new Uint8Array(5) }]
  }), /size limit/);
  assert.equal(state.calls, 0);
});
test('multipart aggregate rejects multiple files that exceed combined limit', async () => {
  const state = { calls: 0 };
  const client = uploadTestClient(4, state);
  await assert.rejects(client.request({
    method: 'POST', apiPath: '/application/example/upload',
    files: [{ field: 'a', name: 'a.bin', bytes: Buffer.alloc(3) }, { field: 'b', name: 'b.bin', bytes: Buffer.alloc(3) }]
  }), /size limit/);
  assert.equal(state.calls, 0);
});
test('multipart local-file upload rejects an oversized path before reading', async t => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'etsy-upload-limit-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'sample.bin');
  await fs.writeFile(file, Buffer.alloc(5));
  const state = { calls: 0 };
  const client = uploadTestClient(4, state);
  await assert.rejects(client.request({
    method: 'POST', apiPath: '/application/example/upload',
    files: [{ field: 'file', path: file }]
  }), /size limit/);
  assert.equal(state.calls, 0);
});
test('multipart accepts an upload exactly at its configured limit', async () => {
  const state = { calls: 0 };
  const client = uploadTestClient(4, state);
  const d = await client.request({
    method: 'POST', apiPath: '/application/example/upload',
    files: [{ field: 'image', name: 'tiny.bin', content_base64: Buffer.alloc(4).toString('base64') }]
  });
  assert.equal(state.calls, 1);
  assert.equal(d.meta.status, 200);
});

test('Etsy HTTP errors never reflect upstream secrets or buyer details', async () => {
  const sentinel = 'sensitive-marker-not-for-output';
  const client = new EtsyClient({
    tokenStore: {
      accessToken: async () => 'local_access',
      apiKeyHeader: async () => 'local_key:secret',
      refresh: async () => 'fresh_access',
    },
    fetchImpl: async () => new Response(JSON.stringify({
      error_description: sentinel, message: sentinel, code: sentinel,
      user: { name: sentinel, address: sentinel },
    }), { status: 422 })
  });
  await assert.rejects(
    client.request({ method: 'POST', apiPath: '/application/listings/123', body: { title: 'test' } }),
    error => {
      assert.equal(error.status, 422);
      assert.equal(error.code, 'ETSY_API_ERROR');
      assert.equal(JSON.stringify({ message: error.message, details: error.details }).includes(sentinel), false);
      assert.match(error.message, /422/);
      return true;
    }
  );
});
