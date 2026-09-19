# Etsy API Hub

Shared internal Etsy Open API v3 integration layer.

The goal is to have one maintained Etsy core that can be used by:

- server agents through `etsyctl`;
- Order Forge and future services through a local HTTP API or direct JS import;
- a future GPT Action adapter;
- maintenance scripts and migrations.

`etsy-manager-pro` is a legacy consumer/reference only. New Etsy integration work belongs here.

## Why this exists

Historically, several projects grew their own Etsy authentication, token refresh, endpoint wrappers and agent-specific restrictions. That creates drift and makes simple maintenance work require ad-hoc authenticated scripts.

Etsy API Hub separates the concerns:

1. Core Etsy transport — credentials, OAuth refresh, 401 recovery, 429 handling and rate-limit metadata.
2. Reusable Etsy operations — listing, personalization, inventory, orders, images and more.
3. Full API escape hatch — any current/future Etsy `/v3/application/*` endpoint can be called without waiting for a wrapper.
4. Interfaces — CLI today, local HTTP API today, future GPT/MCP/project adapters later.

## Quick start

Node.js 22+ is required. No npm dependencies are required.

    cp config.example.json /etc/etsy-api-hub/config.json
    export ETSY_HUB_CONFIG=/etc/etsy-api-hub/config.json
    node bin/etsyctl.mjs shops
    node bin/etsyctl.mjs listing get 123456789

For a global command:

    npm link
    etsyctl shops

## Configuration

The config stores paths to credentials, not credentials themselves.

Credential files must live outside git and should be mode `0600`. The Hub supports the existing Order Forge field names (`client_id`, `secret`, `access_token`, `refresh_token`) so migration can be incremental.

## CLI examples

    etsyctl listing list active --limit 100
    etsyctl listing get 4420886705
    etsyctl listing update 4420886705 @/tmp/change.json
    etsyctl personalization get 4420886705
    etsyctl personalization set 4420886705 @/tmp/questions.json
    etsyctl inventory get 4420886705
    etsyctl orders list --limit 20 --paid true
    etsyctl images list 4420886705
    etsyctl images upload 4420886705 ./cover.jpg --rank 1 --alt "Custom family portrait"

For an endpoint not wrapped yet:

    etsyctl request GET /application/shops/12345678/sections

Friendly write commands snapshot the listing before mutation. Snapshot files contain listing, inventory and personalization data.

## Internal HTTP API

Start:

    node src/server.mjs

The server binds to `127.0.0.1` by default.

Endpoints:

- `GET /health`
- `GET /v1/shops`
- `POST /v1/request`

Example request body:

    {
      "shop": "main",
      "method": "GET",
      "path": "/application/listings/4420886705",
      "query": {"includes": "Images,Personalization"}
    }

If `server.auth_token_file` is configured, all `/v1/*` endpoints require that bearer token. `/health` stays unauthenticated.

The HTTP JSON endpoint intentionally does not accept arbitrary local file paths. File uploads are handled by `etsyctl` or the JS API until a bounded multipart adapter is needed by a real consumer.

## Full access without GPT-specific limits

The core validates only transport-level safety:

- requests must target Etsy `/v3/application/*`;
- arbitrary hosts/full URLs are rejected;
- HTTP method must be GET/POST/PUT/PATCH/DELETE;
- credentials stay server-side.

It does not impose the old GPT Action restrictions such as advanced edits only on draft listings. Etsy remains the authority on whether a particular endpoint/state combination is valid.

## Token refresh

Access tokens are refreshed through Etsy's OAuth refresh grant after a 401. Refresh is guarded by a file lock so parallel agents do not rotate the same token simultaneously. Updated credentials are written atomically with mode `0600`.

## Rate limits

429 responses are retried with bounded backoff. Successful response metadata includes Etsy rate-limit headers when available.

## Migration plan

1. Bootstrap Hub against currently valid credentials without changing live consumers.
2. Use `etsyctl` for agent Etsy maintenance instead of ad-hoc scripts.
3. Move credentials into Hub-owned protected storage.
4. Point Order Forge and other services at Hub.
5. If GPT Actions are needed again, build a thin adapter over Hub rather than maintaining a second Etsy implementation.
6. Retire duplicate Etsy transport/auth code only after consumers are migrated and verified.
