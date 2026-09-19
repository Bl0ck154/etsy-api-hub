import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGptOpenApi } from '../src/gpt-adapter.mjs';

test('GPT schema separates reads from consequential writes', () => {
  const schema = buildGptOpenApi({ publicBaseUrl: 'https://etsy-api.example.test' });
  assert.equal(schema.openapi, '3.1.0');
  assert.equal(schema.paths['/gpt/read'].post.operationId, 'readEtsy');
  assert.equal(schema.paths['/gpt/read'].post['x-openai-isConsequential'], false);
  assert.equal(schema.paths['/gpt/write'].post.operationId, 'writeEtsy');
  assert.equal(schema.paths['/gpt/write'].post['x-openai-isConsequential'], true);
  assert.deepEqual(
    schema.paths['/gpt/write'].post.requestBody.content['application/json'].schema.properties.method.enum,
    ['POST', 'PUT', 'PATCH', 'DELETE'],
  );
});
