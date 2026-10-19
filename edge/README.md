# Etsy API Hub on Cloudflare Workers — Malinary staging

Deploy target: Cloudflare account `Malinary.art@gmail.com's Account`, Worker `etsy-api-hub-malinary` and EU-jurisdiction D1 `etsy-api-hub-edge`.

## Non-destructive migration

The existing Node CLI, local HTTP/MCP, token files and current ChatGPT connection remain untouched. This is a **new independent token owner**. Do not copy the VPS's rotating Etsy refresh token: complete a new Etsy OAuth authorization for each shop. Until verified, `ENABLE_WRITES=false`.

This Worker reuses the repository's `EtsyHub`, `EtsyClient`, `EtsyMcpAdapter`, `ETSY_MCP_TOOLS`, `gptRead` and `gptWrite`; only the transport, credential storage, snapshots and audit are overridden for Workers/D1.

## Setup

1. Deploy on Malinary, never the primary or Oscar account. Create D1 in the **EU jurisdiction** and apply `edge/migrations/0001_init.sql`.
2. The existing VPS was queried via `etsyctl shops` (nonsecret IDs only), and staging is preconfigured for both `main` / `second` in `SHOPS_JSON`. No shop-ID entry is needed. The original approved Etsy API app credentials are reused for **both** configured shops; each shop separately authorizes OAuth and keeps its own token. Two additional `ETSY_SECOND_*` placeholders were created during a mistaken diagnosis; they are ignored by the current Worker and do not need to be filled. Advanced setups can optionally map different apps via `ETSY_APPS_JSON`.
3. Only **three Worker secrets** are required for a single Etsy application, under Settings → Variables and Secrets:
   - `ETSY_CLIENT_ID`: your Etsy app client ID / keystring.
   - `ETSY_CLIENT_SECRET`: the matching Etsy app shared secret.
   - `MCP_OWNER_PASSWORD`: one **random password at least 32 characters** from your password manager. Do not send it in chat or commit it to Git. Use it for ChatGPT MCP login and owner-only administration.
   
   The Worker derives two *domain-separated* encryption/signing keys from that password automatically; there is nothing else to manually create. This is a convenience tradeoff: **keep a recoverable copy in your password manager and do not rotate it without a credential-reencryption plan**, because rotating it invalidates previously sealed Etsy credentials, saved snapshots and MCP sessions. For stricter separation, `TOKEN_ENCRYPTION_KEY`, `MCP_SIGNING_KEY` and `ADMIN_BEARER` are still supported as optional independent secrets. One previously approved app key is sufficient for this Hub's two sellers, as long as each account grants OAuth consent. No second app is required or enforced.

4. In Etsy's app configuration, register `https://etsy-api-hub-malinary.malinary-art.workers.dev/admin/oauth/callback` (or the chosen final host) as an exact OAuth redirect URI.
5. Open `https://etsy-api-hub-malinary.malinary-art.workers.dev/admin/connect`, select the shop, enter the same owner password, and follow the Etsy OAuth screen. No cURL or additional admin token is needed. The callback verifies that the account owns the configured shop ID, stores encrypted credentials, and refuses to replace an existing chain.
6. GET `/admin/status` with your owner password as a Bearer token, if diagnostics are necessary. Test `/health`, `/gpt/openapi.json`, and read-only MCP `tools/list`, `etsy_shops`, `etsy_listing_get` before enabling writes.
7. Connect ChatGPT MCP to `https://etsy-api-hub-malinary.malinary-art.workers.dev/mcp` with OAuth; owner login is restricted to ChatGPT metadata client IDs. GPT Actions can import `/gpt/openapi.json`, but must use a **dedicated scoped service token** (not the owner password). ChatGPT MCP uses its separate password-protected OAuth flow.
8. Only after a verified live read and a reviewed backup/rollback test, change `ENABLE_WRITES` to `true`, redeploy, and switch the existing ChatGPT connector. Do **not** give third-party projects the owner password.

## Service clients — no day-to-day token maintenance

Every backend project or GPT Action receives its own revocable `hubc_` bearer credential, with permissions limited to selected Etsy shops and exact Etsy API path prefixes. Token hashes (not plaintext tokens) are held in D1. Scopes: `read`, `write`, `media` (media also requires write); mutation requires explicit owner confirmation **and** the Worker-level `ENABLE_WRITES=true` switch.

Owner-only API routes (authenticate with `MCP_OWNER_PASSWORD` or optional independent `ADMIN_BEARER`):
- `GET /admin/clients` — nonsecret inventory of clients and last-used timestamps.
- `POST /admin/clients` — register one project. Example `{"name":"Order Forge reporting","scopes":["read"],"shops":["main"],"path_prefixes":["/application/shops/23207964/receipts"]}`. A `token` is returned **once**, then should be installed as a secret in the downstream project. For `write`, additionally set `"confirm_writes":true`.
- `DELETE /admin/clients/{uuid}` — immediately revoke a compromised or retired client.
- `POST /v1/request` — service API with `{"shop":"main","method":"GET","path":"/application/shops/23207964/receipts"}`, plus supported body/query/form/files fields.
- `POST /gpt/read` and `POST /gpt/write` — compatible GPT Actions requiring the dedicated client token.

**Do not distribute the owner password as an API key to other projects.** ChatGPT MCP OAuth continues to have owner-level rights, with unknown/new MCP tools treated as writes until explicitly audited.

The Worker has a daily Cloudflare Cron Trigger at **03:17 UTC** to prune expired MCP authorizations, failed-password counters, and audit entries older than 90 days. Etsy access tokens refresh on demand behind a D1 lease. Individual backend tokens have no short-lived expiration to rotate; revoke any token when a connected project is retired or compromised.

All currently deployed integrations remain on VPS. Enrolling a backend in Cloudflare requires an explicit future cutover. No existing consumer automatically moves when this Worker is deployed.

## Safety

- D1 stores AES-GCM-sealed Etsy credentials and snapshots; the AES and MCP HMAC keys are derived separately from the strong owner password unless optional independent keys are configured. No token plaintext is written to D1/GitHub/logs.
- OAuth PKCE states and authorization codes are single-use. MCP refresh tokens are one-time-use records in D1.
- Refresh-token operations use a per-shop D1 lease before the Etsy refresh request. A crash after the provider rotates but before persisting may still require a fresh Etsy authorization; do not retry concurrent refresh blindly.
- Mutating typed listing operations retain snapshots in D1 and refuse writes if snapshotting fails. Raw `etsy_request_write` has the original no-automatic-backup contract.
- Browser and local-media pipelines remain on VPS; this Worker accepts bounded base64 multipart inputs only.
- Cloudflare Workers body size, memory and CPU limits still apply. Very large uploads may need R2 multipart later.
- **Do not expose** the owner password or admin API through GitHub Actions logs or repository files. The web authorization page uses password verification and D1-backed rate limiting.
- Cloudflare service credentials are checked against the exact shop alias **and** numeric shop ID in Etsy URL paths; path prefixes are segment-boundary-checked.
- Review WAF rate limiting, allowed OAuth clients and write permissions before production cutover.

## Local commands

```sh
cd edge
npm install
npm run check
npx wrangler d1 migrations apply etsy-api-hub-edge --remote
npx wrangler deploy
```

The Cloudflare account must be explicitly selected using the authorized account context. Do not deploy to the wrong account.
