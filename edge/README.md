# Etsy API Hub on Cloudflare Workers — Malinary staging

Deploy target: Cloudflare account `Malinary.art@gmail.com's Account`, Worker `etsy-api-hub-malinary` and EU-jurisdiction D1 `etsy-api-hub-edge`.

## Non-destructive migration

The existing Node CLI, local HTTP/MCP, token files and current ChatGPT connection remain untouched. This is a **new independent token owner**. Do not copy the VPS's rotating Etsy refresh token: complete a new Etsy OAuth authorization for each shop. Until verified, `ENABLE_WRITES=false`.

This Worker reuses the repository's `EtsyHub`, `EtsyClient`, `EtsyMcpAdapter`, `ETSY_MCP_TOOLS`, `gptRead` and `gptWrite`; only the transport, credential storage, snapshots and audit are overridden for Workers/D1.

## Setup

1. Deploy on Malinary, never the primary or Oscar account. Create D1 in the **EU jurisdiction** and apply `edge/migrations/0001_init.sql`.
2. In `edge/wrangler.toml`, set `SHOPS_JSON` to a map of actual shop aliases and verified Etsy shop IDs (example: `{"main":{"shop_id":"12345678"}}`). Avoid placeholder IDs. For multiple Etsy apps configure `ETSY_APPS_JSON` as a Cloudflare secret mapping each alias to `{"client_id":"...","secret":"..."}`.
3. Set these **Cloudflare Worker secrets**, never in Git:
   - `TOKEN_ENCRYPTION_KEY`: random 32+ character independent key; keep a secure backup because losing it loses access to encrypted token records and listing snapshots.
   - `ETSY_CLIENT_ID` and `ETSY_CLIENT_SECRET` for a single shared Etsy application, OR `ETSY_APPS_JSON` for multiple applications.
   - `ADMIN_BEARER`: cryptographically random 32+ character secret for private bootstrap and GPT Action access.
   - `MCP_OWNER_PASSWORD`: strong owner-only login password for ChatGPT OAuth.
   - `MCP_SIGNING_KEY`: independent random 32+ character secret for MCP access/refresh tokens.
4. In Etsy's app configuration, register `https://etsy-api-hub-malinary.malinary-art.workers.dev/admin/oauth/callback` (or the chosen final host) as an exact OAuth redirect URI.
5. With the admin bearer, POST `{"shop":"main"}` to `/admin/oauth/start`. Open `authorization_url`, log in to the correct Etsy account, and approve scopes. The callback verifies that the account owns the configured shop ID, stores encrypted credentials, and refuses to replace an existing chain.
6. GET `/admin/status` with admin bearer. Test `/health`, `/gpt/openapi.json`, and read-only MCP `tools/list`, `etsy_shops`, `etsy_listing_get` before enabling writes.
7. Connect ChatGPT MCP to `https://etsy-api-hub-malinary.malinary-art.workers.dev/mcp` with OAuth; owner login is restricted to ChatGPT metadata client IDs. GPT Actions can instead import `/gpt/openapi.json` and use `ADMIN_BEARER`.
8. Only after a verified live read and a reviewed backup/rollback test, change `ENABLE_WRITES` to `true`, redeploy, and switch the existing ChatGPT connector.

## Safety

- D1 stores AES-GCM-sealed Etsy credentials and snapshots; no token plaintext is written to D1/GitHub/logs.
- OAuth PKCE states and authorization codes are single-use. MCP refresh tokens are one-time-use records in D1.
- Refresh-token operations use a per-shop D1 lease before the Etsy refresh request. A crash after the provider rotates but before persisting may still require a fresh Etsy authorization; do not retry concurrent refresh blindly.
- Mutating typed listing operations retain snapshots in D1 and refuse writes if snapshotting fails. Raw `etsy_request_write` has the original no-automatic-backup contract.
- Browser and local-media pipelines remain on VPS; this Worker accepts bounded base64 multipart inputs only.
- Cloudflare Workers body size, memory and CPU limits still apply. Very large uploads may need R2 multipart later.
- **Do not expose** the admin endpoint or bearer via GitHub Actions logs or repository files.
- Review CORS, WAF rate limiting, allowed OAuth clients and write permissions before production cutover.

## Local commands

```sh
cd edge
npm install
npm run check
npx wrangler d1 migrations apply etsy-api-hub-edge --remote
npx wrangler deploy
```

The Cloudflare account must be explicitly selected using the authorized account context. Do not deploy to the wrong account.
