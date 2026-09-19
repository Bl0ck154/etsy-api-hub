import http from 'node:http';
import fs from 'node:fs/promises';
import { loadConfig, publicConfig } from './config.mjs';
import { EtsyHub } from './hub.mjs';
import { buildGptOpenApi, gptRead, gptWrite } from './gpt-adapter.mjs';

const MAX_BODY = 2 * 1024 * 1024;

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request body too large'), { status: 413, code: 'BODY_TOO_LARGE' });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('Request body must be valid JSON'), { status: 400, code: 'INVALID_JSON' }); }
}

function send(res, status, value) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function loadInternalToken(config) {
  const file = config.server.auth_token_file;
  if (!file) return null;
  return (await fs.readFile(file, 'utf8')).trim();
}

const config = await loadConfig();
const hub = new EtsyHub(config);
const internalToken = await loadInternalToken(config);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, service: 'etsy-api-hub' });
    }

    if (req.method === 'GET' && url.pathname === '/gpt/openapi.json') {
      const publicBaseUrl = config.server.public_base_url || `http://127.0.0.1:${config.server.port}`;
      return send(res, 200, buildGptOpenApi({ publicBaseUrl }));
    }

    if (internalToken) {
      const auth = String(req.headers.authorization || '');
      if (auth !== `Bearer ${internalToken}`) return send(res, 401, { ok: false, error: 'unauthorized' });
    }

    if (req.method === 'POST' && url.pathname === '/gpt/read') {
      const body = await readBody(req);
      const result = await gptRead(hub, body);
      return send(res, 200, { ok: true, data: result.data, meta: result.meta });
    }

    if (req.method === 'POST' && url.pathname === '/gpt/write') {
      const body = await readBody(req);
      const result = await gptWrite(hub, body);
      return send(res, 200, { ok: true, data: result.data, meta: result.meta });
    }

    if (req.method === 'GET' && url.pathname === '/v1/shops') {
      return send(res, 200, { ok: true, data: publicConfig(config) });
    }

    if (req.method === 'POST' && url.pathname === '/v1/request') {
      const body = await readBody(req);
      const result = await hub.request({
        shop: body.shop,
        method: body.method || 'GET',
        apiPath: body.path,
        query: body.query,
        body: body.body,
        operation: 'http.raw',
      });
      return send(res, 200, { ok: true, data: result.data, meta: result.meta });
    }

    return send(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    return send(res, Number(error?.status || 500), {
      ok: false,
      error: error?.code || 'internal_error',
      message: error?.message || String(error),
      ...(error?.details ? { details: error.details } : {}),
    });
  }
});

server.listen(config.server.port, config.server.host, () => {
  console.log(JSON.stringify({
    service: 'etsy-api-hub',
    listening: `${config.server.host}:${config.server.port}`,
    auth_enabled: Boolean(internalToken),
  }));
});
