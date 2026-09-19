import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeApiPath } from '../src/client.mjs';

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
