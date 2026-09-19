import fs from 'node:fs/promises';
import path from 'node:path';
import { Blob } from 'node:buffer';
import { EtsyHubError, inputError } from './errors.mjs';

const API_BASE = 'https://api.etsy.com/v3';
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalizeApiPath(value) {
  let p = String(value || '').trim();
  if (!p) throw inputError('Etsy API path is required');
  if (/^https?:\/\//i.test(p)) throw inputError('Pass an Etsy API path, not a full URL', 'ABSOLUTE_URL_FORBIDDEN');
  if (!p.startsWith('/')) p = '/' + p;
  if (p.startsWith('/v3/')) p = p.slice(3);
  if (!p.startsWith('/application/')) {
    throw inputError('Only Etsy /application/* API paths are allowed through the shared request interface', 'INVALID_ETSY_PATH');
  }
  if (p.includes('..')) throw inputError('Path traversal is not allowed', 'INVALID_ETSY_PATH');
  return p;
}

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.heic': 'image/heic',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.pdf': 'application/pdf',
    '.zip': 'application/zip', '.txt': 'text/plain',
  })[ext] || 'application/octet-stream';
}

function rateMeta(headers) {
  const keys = [
    'x-limit-per-second', 'x-remaining-this-second',
    'x-limit-per-day', 'x-remaining-today', 'retry-after',
  ];
  return Object.fromEntries(keys.map(key => [key, headers.get(key)]).filter(([, value]) => value != null));
}

async function parseResponse(response) {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

export class EtsyClient {
  constructor({ tokenStore, fetchImpl = fetch, max429Retries = 3 } = {}) {
    if (!tokenStore) throw inputError('tokenStore is required');
    this.tokenStore = tokenStore;
    this.fetchImpl = fetchImpl;
    this.max429Retries = max429Retries;
  }

  async request({ method = 'GET', apiPath, query = null, body = undefined, form = null, files = null, headers = {} } = {}, state = {}) {
    const verb = String(method).toUpperCase();
    if (!ALLOWED_METHODS.has(verb)) throw inputError(`Unsupported HTTP method: ${verb}`);
    const normalizedPath = normalizeApiPath(apiPath);
    const url = new URL(API_BASE + normalizedPath);
    if (query && typeof query === 'object') {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') continue;
        if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, String(item));
        else url.searchParams.set(key, String(value));
      }
    }

    const currentAccessToken = state.accessToken || await this.tokenStore.accessToken();
    const apiKey = await this.tokenStore.apiKeyHeader();
    let payload = body;
    const requestHeaders = {
      'x-api-key': apiKey,
      Authorization: `Bearer ${currentAccessToken}`,
      ...headers,
    };

    if (files?.length) {
      const multipart = new FormData();
      for (const [key, value] of Object.entries(form || {})) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) for (const item of value) multipart.append(key, String(item));
        else multipart.append(key, String(value));
      }
      for (const file of files) {
        const bytes = await fs.readFile(file.path);
        multipart.append(file.field, new Blob([bytes], { type: file.mime || mimeFor(file.path) }), file.name || path.basename(file.path));
      }
      payload = multipart;
    } else if (form) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(form)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) for (const item of value) params.append(key, String(item));
        else params.append(key, String(value));
      }
      payload = params;
      requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (body !== undefined && body !== null && !(body instanceof FormData) && !(body instanceof URLSearchParams) && typeof body !== 'string') {
      payload = JSON.stringify(body);
      requestHeaders['Content-Type'] = 'application/json';
    } else if (typeof body === 'string' && !requestHeaders['Content-Type']) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const response = await this.fetchImpl(url, {
      method: verb,
      headers: requestHeaders,
      ...(verb === 'GET' ? {} : { body: payload }),
    });

    if (response.status === 401 && !state.refreshed) {
      const accessToken = await this.tokenStore.refresh(currentAccessToken);
      return this.request({ method: verb, apiPath: normalizedPath, query, body, form, files, headers }, {
        ...state, refreshed: true, accessToken,
      });
    }

    if (response.status === 429 && (state.retry429 || 0) < this.max429Retries) {
      const retryAfter = Number(response.headers.get('retry-after') || 0);
      const backoff = Math.max(retryAfter * 1000, 500 * (2 ** (state.retry429 || 0)));
      await sleep(Math.min(backoff, 10_000));
      return this.request({ method: verb, apiPath: normalizedPath, query, body, form, files, headers }, {
        ...state, retry429: (state.retry429 || 0) + 1, accessToken: currentAccessToken,
      });
    }

    const data = await parseResponse(response);
    const meta = { status: response.status, rate_limit: rateMeta(response.headers), method: verb, path: normalizedPath };
    if (!response.ok) {
      const message = data?.error_description || data?.error || data?.message || `Etsy API HTTP ${response.status}`;
      throw new EtsyHubError(String(message), {
        code: data?.code || 'ETSY_API_ERROR',
        status: response.status,
        details: { response: data, meta },
      });
    }
    return { data, meta };
  }
}

export { normalizeApiPath };
