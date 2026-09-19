import { inputError } from './errors.mjs';

function baseUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(raw) && !/^http:\/\/127\.0\.0\.1(?::\d+)?$/i.test(raw)) {
    throw inputError('GPT public_base_url must be HTTPS (or localhost for development)', 'INVALID_PUBLIC_BASE_URL');
  }
  return raw;
}

export function buildGptOpenApi({ publicBaseUrl } = {}) {
  const server = baseUrl(publicBaseUrl);
  const requestPath = {
    type: 'string',
    minLength: 1,
    pattern: '^/application/',
    description: 'Etsy Open API v3 path beginning with /application/. Full URLs are not accepted.',
  };
  const query = {
    type: 'object',
    additionalProperties: {
      oneOf: [
        { type: 'string' },
        { type: 'number' },
        { type: 'boolean' },
        { type: 'array', items: { type: 'string' } },
      ],
    },
  };

  return {
    openapi: '3.1.0',
    info: {
      title: 'Etsy API Hub Action',
      version: '0.1.0',
      description: 'Thin GPT Action adapter over the shared Etsy API Hub. Etsy credentials remain server-side.',
    },
    servers: [{ url: server }],
    paths: {
      '/gpt/read': {
        post: {
          operationId: 'readEtsy',
          summary: 'Read any Etsy Open API application resource',
          description: 'Performs a GET against an Etsy /v3/application/* resource using the selected configured shop credential.',
          'x-openai-isConsequential': false,
          security: [{ HubBearer: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['path'],
                  properties: {
                    shop: { type: 'string', description: 'Configured Hub shop alias. Omit for default shop.' },
                    path: requestPath,
                    query,
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Etsy response' },
            400: { description: 'Invalid request' },
            401: { description: 'Invalid Hub API key' },
            502: { description: 'Upstream Etsy error' },
          },
        },
      },
      '/gpt/write': {
        post: {
          operationId: 'writeEtsy',
          summary: 'Write to any Etsy Open API application resource',
          description: 'Performs a POST, PUT, PATCH, or DELETE against an Etsy /v3/application/* resource. Use only after the owner explicitly requests the change.',
          'x-openai-isConsequential': true,
          security: [{ HubBearer: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['method', 'path'],
                  properties: {
                    shop: { type: 'string', description: 'Configured Hub shop alias. Omit for default shop.' },
                    method: { type: 'string', enum: ['POST', 'PUT', 'PATCH', 'DELETE'] },
                    path: requestPath,
                    query,
                    body: {
                      type: ['object', 'array', 'string', 'number', 'boolean', 'null'],
                      description: 'JSON request body passed to Etsy.',
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Etsy response' },
            400: { description: 'Invalid request' },
            401: { description: 'Invalid Hub API key' },
            502: { description: 'Upstream Etsy error' },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        HubBearer: {
          type: 'http',
          scheme: 'bearer',
          description: 'Static server-to-server API key configured in the GPT Action editor.',
        },
      },
    },
  };
}

export async function gptRead(hub, body = {}) {
  if (!body?.path) throw inputError('path is required');
  return hub.request({
    shop: body.shop,
    method: 'GET',
    apiPath: body.path,
    query: body.query,
    operation: 'gpt.read',
  });
}

export async function gptWrite(hub, body = {}) {
  const method = String(body?.method || '').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    throw inputError('method must be POST, PUT, PATCH, or DELETE');
  }
  if (!body?.path) throw inputError('path is required');
  return hub.request({
    shop: body.shop,
    method,
    apiPath: body.path,
    query: body.query,
    body: body.body,
    operation: 'gpt.write',
  });
}
