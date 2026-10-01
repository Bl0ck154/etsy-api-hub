import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SCOPE = 'etsy';
const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 90;
const CODE_TTL_MS = 5 * 60_000;

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(body);
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function base64UrlSha256(value) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

function normalizeBase(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('OAuth requires HTTPS');
  return `${url.protocol}//${url.host}`;
}

async function readForm(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const b = Buffer.from(chunk);
    total += b.length;
    if (total > 16 * 1024) throw new Error('oauth_request_too_large');
    chunks.push(b);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

export class EtsyMcpOAuth {
  constructor(secret, stateDir) {
    this.secret = secret;
    this.lockPath = path.join(stateDir, 'mcp-chatgpt-client.json');
    this.codes = new Map();
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  }

  signToken(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', this.secret).update(body).digest('base64url');
    return `v1.${body}.${signature}`;
  }

  verifyToken(token, expectedType, resource) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') return null;
    const expected = crypto.createHmac('sha256', this.secret).update(parts[1]).digest('base64url');
    if (!safeEqual(parts[2], expected)) return null;
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      const now = Math.floor(Date.now() / 1000);
      if (payload.typ !== expectedType || payload.sub !== 'owner' || payload.aud !== resource || payload.exp <= now || payload.iat > now + 60) return null;
      if (!String(payload.scope || '').split(/\s+/).includes(SCOPE) || !payload.client_id) return null;
      return payload;
    } catch {
      return null;
    }
  }

  verifyAccessToken(token, resource) {
    return Boolean(this.verifyToken(token, 'access', resource));
  }

  challenge(baseUrl, error = 'invalid_token', description = 'Authentication is required to use Etsy Shop Manager.') {
    const base = normalizeBase(baseUrl);
    const clean = description.replace(/["\\]/g, '');
    return `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource", scope="${SCOPE}", error="${error}", error_description="${clean}"`;
  }

  loadLockedClient() {
    try {
      const data = JSON.parse(fs.readFileSync(this.lockPath, 'utf8'));
      return typeof data.client_id === 'string' && data.client_id ? data.client_id : null;
    } catch {
      return null;
    }
  }

  lockClient(clientId) {
    const existing = this.loadLockedClient();
    if (existing) {
      if (existing !== clientId) throw new Error('unauthorized_client');
      return;
    }
    const payload = JSON.stringify({ client_id: clientId, created_at: new Date().toISOString() }, null, 2) + '\n';
    try {
      const fd = fs.openSync(this.lockPath, 'wx', 0o600);
      try { fs.writeFileSync(fd, payload); } finally { fs.closeSync(fd); }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (this.loadLockedClient() !== clientId) throw new Error('unauthorized_client');
    }
  }

  async validateChatGptClient(clientId, redirectUri) {
    const clientUrl = new URL(clientId);
    if (clientUrl.protocol !== 'https:' || clientUrl.hostname !== 'chatgpt.com' || clientUrl.search || clientUrl.hash || !/^\/oauth\/[^/]+\/client\.json$/.test(clientUrl.pathname)) {
      throw new Error('unauthorized_client');
    }
    const redirect = new URL(redirectUri);
    if (redirect.protocol !== 'https:' || redirect.hostname !== 'chatgpt.com' || !redirect.pathname.startsWith('/connector/oauth/')) {
      throw new Error('invalid_redirect_uri');
    }
    const response = await fetch(clientUrl, {
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error('invalid_client_metadata');
    const metadata = await response.json();
    if (metadata.client_id !== clientId || metadata.client_name !== 'ChatGPT' || !Array.isArray(metadata.redirect_uris) || !metadata.redirect_uris.includes(redirectUri)) {
      throw new Error('invalid_client_metadata');
    }
    const supportedAuthMethods = Array.isArray(metadata.token_endpoint_auth_methods_supported)
      ? metadata.token_endpoint_auth_methods_supported.filter(value => typeof value === 'string')
      : typeof metadata.token_endpoint_auth_method === 'string' ? [metadata.token_endpoint_auth_method] : [];
    if (!supportedAuthMethods.includes('none')) throw new Error('unsupported_client_auth');
    this.lockClient(clientId);
  }

  issueTokens(clientId, resource, scope = SCOPE) {
    const now = Math.floor(Date.now() / 1000);
    const base = { sub: 'owner', client_id: clientId, scope, aud: resource, iat: now };
    const access = this.signToken({ ...base, typ: 'access', exp: now + ACCESS_TTL_SECONDS, jti: crypto.randomUUID() });
    const refresh = this.signToken({ ...base, typ: 'refresh', exp: now + REFRESH_TTL_SECONDS, jti: crypto.randomUUID() });
    return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: ACCESS_TTL_SECONDS, scope };
  }

  async handle(req, res, url, baseUrl) {
    const oauthPaths = new Set([
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
      '/.well-known/oauth-authorization-server',
      '/.well-known/openid-configuration',
      '/oauth/authorize',
      '/oauth/token',
    ]);
    if (!oauthPaths.has(url.pathname)) return false;

    const base = normalizeBase(baseUrl);
    const resource = `${base}/mcp`;

    if (req.method === 'GET' && (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp')) {
      json(res, 200, {
        resource,
        authorization_servers: [base],
        scopes_supported: [SCOPE],
        resource_name: 'Etsy Shop Manager',
      });
      return true;
    }

    if (req.method === 'GET' && (url.pathname === '/.well-known/oauth-authorization-server' || url.pathname === '/.well-known/openid-configuration')) {
      json(res, 200, {
        issuer: base,
        authorization_endpoint: `${base}/oauth/authorize`,
        token_endpoint: `${base}/oauth/token`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: [SCOPE],
        client_id_metadata_document_supported: true,
      });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/oauth/authorize') {
      const responseType = url.searchParams.get('response_type') || '';
      const clientId = url.searchParams.get('client_id') || '';
      const redirectUri = url.searchParams.get('redirect_uri') || '';
      const challenge = url.searchParams.get('code_challenge') || '';
      const challengeMethod = url.searchParams.get('code_challenge_method') || '';
      const requestedResource = url.searchParams.get('resource') || '';
      const requestedScope = url.searchParams.get('scope')?.trim() || SCOPE;
      const state = url.searchParams.get('state') || '';
      try {
        if (responseType !== 'code' || challengeMethod !== 'S256' || challenge.length < 43 || requestedResource !== resource) throw new Error('invalid_request');
        if (requestedScope.split(/\s+/).some(scope => scope !== SCOPE)) throw new Error('invalid_scope');
        await this.validateChatGptClient(clientId, redirectUri);
        const code = crypto.randomBytes(32).toString('base64url');
        this.codes.set(code, {
          clientId,
          redirectUri,
          codeChallenge: challenge,
          resource,
          scope: requestedScope,
          expiresAt: Date.now() + CODE_TTL_MS,
        });
        const target = new URL(redirectUri);
        target.searchParams.set('code', code);
        if (state) target.searchParams.set('state', state);
        res.writeHead(302, { location: target.toString(), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
        res.end();
      } catch (error) {
        const code = ['unauthorized_client', 'invalid_redirect_uri', 'invalid_scope'].includes(error?.message)
          ? error.message
          : 'invalid_request';
        if (redirectUri) {
          try {
            const target = new URL(redirectUri);
            target.searchParams.set('error', code);
            if (state) target.searchParams.set('state', state);
            res.writeHead(302, { location: target.toString(), 'cache-control': 'no-store' });
            res.end();
          } catch {
            json(res, 400, { error: code });
          }
        } else {
          json(res, 400, { error: code });
        }
      }
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/oauth/token') {
      try {
        const form = await readForm(req);
        const grantType = form.get('grant_type') || '';
        const clientId = form.get('client_id') || '';
        if (!clientId || this.loadLockedClient() !== clientId) {
          json(res, 401, { error: 'invalid_client' });
          return true;
        }
        if (grantType === 'authorization_code') {
          const code = form.get('code') || '';
          const verifier = form.get('code_verifier') || '';
          const redirectUri = form.get('redirect_uri') || '';
          const requestedResource = form.get('resource') || '';
          const record = this.codes.get(code);
          this.codes.delete(code);
          if (!record || record.expiresAt < Date.now() || record.clientId !== clientId || record.redirectUri !== redirectUri || record.resource !== requestedResource || record.resource !== resource || base64UrlSha256(verifier) !== record.codeChallenge) {
            json(res, 400, { error: 'invalid_grant' });
            return true;
          }
          json(res, 200, this.issueTokens(clientId, resource, record.scope));
          return true;
        }
        if (grantType === 'refresh_token') {
          const refreshToken = form.get('refresh_token') || '';
          const requestedResource = form.get('resource') || resource;
          const payload = this.verifyToken(refreshToken, 'refresh', requestedResource);
          if (!payload || payload.client_id !== clientId || requestedResource !== resource) {
            json(res, 400, { error: 'invalid_grant' });
            return true;
          }
          json(res, 200, this.issueTokens(clientId, resource, payload.scope));
          return true;
        }
        json(res, 400, { error: 'unsupported_grant_type' });
      } catch {
        json(res, 400, { error: 'invalid_request' });
      }
      return true;
    }

    return false;
  }
}
