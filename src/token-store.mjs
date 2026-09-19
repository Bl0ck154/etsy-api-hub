import fs from 'node:fs/promises';
import path from 'node:path';
import { EtsyHubError, inputError } from './errors.mjs';

const TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function keyFrom(data) {
  return String(data?.client_id || data?.api_key || '').trim();
}

function secretFrom(data) {
  return String(data?.secret || data?.shared_secret || '').trim();
}

async function atomicWriteJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await fs.chmod(tmp, 0o600);
  await fs.rename(tmp, file);
  await fs.chmod(file, 0o600);
}

export class TokenFileStore {
  constructor(file, { fetchImpl = fetch } = {}) {
    this.file = file;
    this.fetchImpl = fetchImpl;
  }

  async read() {
    let data;
    try {
      data = JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') throw inputError(`Credential file not found: ${this.file}`, 'CREDENTIAL_FILE_NOT_FOUND');
      if (error instanceof SyntaxError) throw inputError(`Credential file is not valid JSON: ${this.file}`, 'INVALID_CREDENTIAL_FILE');
      throw error;
    }
    const clientId = keyFrom(data);
    const secret = secretFrom(data);
    if (!clientId || !secret || !data?.access_token || !data?.refresh_token) {
      throw inputError(`Credential file ${this.file} is missing client_id/api_key, secret, access_token, or refresh_token`, 'INVALID_CREDENTIAL_FILE');
    }
    return data;
  }

  async apiKeyHeader() {
    const data = await this.read();
    return `${keyFrom(data)}:${secretFrom(data)}`;
  }

  async accessToken() {
    return String((await this.read()).access_token);
  }

  async refresh(staleAccessToken = null) {
    const lock = `${this.file}.refresh.lock`;
    let handle = null;
    const deadline = Date.now() + 15_000;

    while (!handle) {
      try {
        handle = await fs.open(lock, 'wx', 0o600);
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        try {
          const stat = await fs.stat(lock);
          if (Date.now() - stat.mtimeMs > 120_000) await fs.unlink(lock);
        } catch {}
        if (Date.now() >= deadline) throw new EtsyHubError('Timed out waiting for token refresh lock', { code: 'TOKEN_REFRESH_LOCK_TIMEOUT', status: 503 });
        await sleep(150);
      }
    }

    try {
      const current = await this.read();
      if (staleAccessToken && current.access_token !== staleAccessToken) return current.access_token;

      const clientId = keyFrom(current);
      const form = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: String(current.refresh_token),
      });
      const response = await this.fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      });
      const text = await response.text();
      let payload;
      try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
      if (!response.ok || !payload?.access_token) {
        throw new EtsyHubError(payload?.error_description || payload?.error || `Etsy token refresh failed with HTTP ${response.status}`, {
          code: 'TOKEN_REFRESH_FAILED',
          status: response.status || 502,
          details: { status: response.status },
        });
      }
      const next = {
        ...current,
        ...payload,
        client_id: current.client_id || clientId,
        secret: current.secret || secretFrom(current),
        refreshed_at: new Date().toISOString(),
      };
      await atomicWriteJson(this.file, next);
      return String(next.access_token);
    } finally {
      try { await handle?.close(); } catch {}
      try { await fs.unlink(lock); } catch {}
    }
  }
}
