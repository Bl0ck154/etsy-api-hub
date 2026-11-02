import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EtsyClient } from '../src/client.mjs';
import { createPathMultipart } from '../src/multipart-stream.mjs';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'etsy-streaming-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
const tokens = {
  accessToken: async () => 'test-access',
  apiKeyHeader: async () => 'key:secret',
  refresh: async () => 'test-refreshed',
};

test('streamed local multipart chunks are bounded and content-length matches', async t => {
  const dir = await fixture(t);
  const file = path.join(dir, 'example.bin');
  await fs.writeFile(file, Buffer.alloc(360 * 1024, 65));
  let seen = false;
  const client = new EtsyClient({
    tokenStore: tokens,
    fetchImpl: async (_url, init) => {
      assert.equal(init.duplex, 'half');
      assert.match(init.headers['Content-Type'], /^multipart\/form-data; boundary=etsy-mcp-/);
      const reader = init.body.getReader();
      let total = 0;
      let maxChunk = 0;
      let firstBytes = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        maxChunk = Math.max(maxChunk, chunk.length);
        if (total < 4000) firstBytes += chunk.toString('utf8', 0, Math.min(4000 - total, chunk.length));
        total += chunk.length;
      }
      assert.equal(total, Number(init.headers['Content-Length']));
      assert(maxChunk <= 64 * 1024);
      assert.match(firstBytes, /name="image"; filename="example.bin"/);
      assert.match(firstBytes, /name="rank"/);
      seen = true;
      return new Response('{}', { status: 200 });
    },
  });
  const result = await client.request({
    method: 'POST', apiPath: '/application/listings/123/images',
    form: { rank: 3 }, files: [{ field: 'image', path: file }],
  });
  assert.equal(result.meta.status, 200);
  assert.equal(seen, true);
});

test('stream rejects oversized local path before network', async t => {
  const dir = await fixture(t);
  const file = path.join(dir, 'oversized.bin');
  await fs.writeFile(file, Buffer.alloc(19));
  let calls = 0;
  const client = new EtsyClient({
    tokenStore: tokens, maxUploadBytes: 18,
    fetchImpl: async () => { calls++; return new Response('{}'); },
  });
  await assert.rejects(client.request({
    method: 'POST', apiPath: '/application/listings/123/images',
    files: [{ field: 'image', path: file }],
  }), /size limit/);
  assert.equal(calls, 0);
});

test('streaming local paths rejects symlinks and dangerous multipart headers', async t => {
  const dir = await fixture(t);
  const file = path.join(dir, 'safe.bin');
  await fs.writeFile(file, Buffer.alloc(10));
  const unsafe = createPathMultipart({
    files: [{ field: 'image\r\nX-Injected: yes', path: file }],
    maxUploadBytes: 100, mimeFor: () => 'application/octet-stream',
  });
  await assert.rejects(unsafe, /Invalid multipart field/);
  const link = path.join(dir, 'link.bin');
  try { await fs.symlink(file, link); }
  catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') return;
    throw error;
  }
  await assert.rejects(createPathMultipart({
    files: [{ field: 'image', path: link }],
    maxUploadBytes: 100, mimeFor: () => 'application/octet-stream',
  }), /not a symlink/);
});

test('multipart stream fails closed if source changes after preflight', async t => {
  const dir = await fixture(t);
  const file = path.join(dir, 'mutable.bin');
  await fs.writeFile(file, Buffer.alloc(300));
  const request = await createPathMultipart({
    files: [{ field: 'file', path: file }],
    maxUploadBytes: 1000, mimeFor: () => 'application/octet-stream',
  });
  await fs.truncate(file, 12);
  const reader = request.body.getReader();
  await assert.rejects(async () => {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
    }
  }, /changed during streaming/);
});
