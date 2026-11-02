<div align="center"><img src="assets/etsy-seller-mcp-hub.svg" alt="Etsy Seller MCP Hub for shop owners" width="100%"></div>

# Etsy Seller MCP Hub

[![CI](https://github.com/Bl0ck154/etsy-seller-mcp-hub/actions/workflows/ci.yml/badge.svg)](https://github.com/Bl0ck154/etsy-seller-mcp-hub/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/etsy-seller-mcp-hub)](https://www.npmjs.com/package/etsy-seller-mcp-hub)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[Official MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=etsy-seller-mcp-hub)
[![Glama score](https://glama.ai/mcp/servers/Bl0ck154/etsy-seller-mcp-hub/badges/score.svg)](https://glama.ai/mcp/servers/Bl0ck154/etsy-seller-mcp-hub)

**Open-source MCP server for Etsy sellers.** Manage your own Etsy shop's listings, orders, inventory, personalization and media with AI assistants, scripts or local applications. Built on the Etsy Open API v3 with **79 MCP tools**, a CLI and a local HTTP gateway.

This is a **seller-side shop management toolkit**. It does not monitor consumer prices, search for buyer deals or automate shopping.

**[First-time setup](docs/QUICKSTART.md)** · [Security review](docs/SECURITY-REVIEW.md) · [Connector troubleshooting](docs/CONNECTORS.md) · [MCP configs](docs/MCP.md) · [Seller workflows demo](docs/DEMO.md) · [Existing API keys](docs/ACCESS.md) · [Hosting and privacy](docs/SECURITY-BOUNDARIES.md) · [Roadmap](docs/ROADMAP.md) · [Glama listing](https://glama.ai/mcp/servers/Bl0ck154/etsy-seller-mcp-hub) · [FAQ](docs/FAQ.md) · [Directories](docs/DIRECTORIES.md)

> The term 'Etsy' is a trademark of Etsy, Inc. This Application uses Etsy's API, but is not endorsed or certified by Etsy.

## What can sellers do?

- Inspect active listings and inventory; review orders, transactions, shop data and shipping settings.
- Update approved listings, inventory and personalization; upload product images, videos or files.
- Use Etsy's current Open API v3 endpoints through 79 MCP tools, with advanced raw API operations when needed.
- Run the same seller workflows from the `etsyctl` CLI, local HTTP API or compatible AI clients.

Example prompts: “Which of my active listings have low stock?”, “Show paid but unshipped orders by ID”, “Review the personalization options for listing 123456789”, “Prepare these listing changes for my approval”.

Seller-focused **read-only workflows**: `etsy_report_low_stock` (bounded inventory scan) and `etsy_report_unshipped` (minimized customer data). CLI equivalents: `etsyctl report low-stock` and `etsyctl report unshipped`.

| Interface | Audience | Status |
| --- | --- | --- |
| Local MCP (stdio) | Claude Desktop, Cursor and other compatible clients | Available |
| CLI / `etsyctl` | Scripts, seller automations and backend agents | Available |
| Local HTTP / GPT Actions | Seller integrations | Available |
| Remote MCP via HTTPS | Private, owner-only ChatGPT connector | Implemented, restricted |
| One public server for many unrelated shops | Multi-tenant SaaS operators | **Not implemented** |

## Quick start

See the [step-by-step guide](docs/QUICKSTART.md) for Etsy authorization and operating system details.

Requires **Node.js 22+** plus an approved Etsy Open API v3 app and authorized credentials.

### Install from npm

Install the public package from [npm](https://www.npmjs.com/package/etsy-seller-mcp-hub):

~~~bash
npm install -g etsy-seller-mcp-hub
etsyctl init --shop-id 12345678    # replace with your actual shop ID
etsyctl doctor                    # inspect local config, then enter your own credentials
# Complete Etsy OAuth as documented in docs/QUICKSTART.md
etsy-mcp
~~~

The npm package is `etsy-seller-mcp-hub`. For first use, add `ETSY_MCP_READ_ONLY=1` in the MCP client config. The installed commands remain `etsy-mcp` (local MCP server) and `etsyctl` (CLI).

### Run from source

~~~bash
git clone https://github.com/Bl0ck154/etsy-seller-mcp-hub.git
cd etsy-seller-mcp-hub
cp config.example.json /tmp/etsy-seller-config.json
# Edit shop_id, credential paths, and local backup paths in the copied JSON.
export ETSY_HUB_CONFIG=/tmp/etsy-seller-config.json
node bin/etsyctl.mjs shops
node bin/etsy-mcp.mjs
~~~

Configuration examples use Linux filesystem locations. Replace them with absolute paths for your computer; **never commit keys or tokens**. The `shops` command lists configured shop aliases, whereas live shop operations require OAuth. See [credentials.example.json](credentials.example.json) and [MCP client setup](docs/MCP.md).

### CLI examples

```bash
etsyctl --help
etsyctl doctor
etsyctl report low-stock --threshold 3 --limit 10 --offset 0
etsyctl report unshipped --limit 20 --offset 0
```

The seller reports are read-only and do not return buyer contact information in the paid/unshipped summary.

### Advanced CLI examples

~~~bash
etsyctl listing list active --limit 100
etsyctl listing get 1234567890
etsyctl inventory get 1234567890
etsyctl orders list --limit 20 --paid true
etsyctl personalization get 1234567890
etsyctl images list 1234567890
etsyctl request GET /application/shops/12345678/sections
~~~

## Will my old Etsy API key work?

**Yes, if it is an existing approved key for Etsy Open API v3 and you have the required OAuth authorization.** Etsy's July 2026 Seller App tier is an easier approval path for new shop owners. Etsy explicitly says that sellers who already hold a Personal Key are not eligible for that new tier because their current keys offer comparable access.

MCP adds an interface for AI clients; it does not change Etsy's permissions. We do **not** operate a shared server that collects other sellers' Etsy tokens. Seller Apps are **own-shop only**. A developer operating one service for unrelated sellers needs suitable Etsy access (Personal App and potentially Commercial Access) and secure multi-tenant OAuth, which this repository does not currently implement. Each self-hosted user must configure their **own authorized credentials**.

Read [Etsy API access: existing keys, Seller Apps and Commercial Access](docs/ACCESS.md).

## Authentication and security

Etsy v3 requires a keystring and shared secret in the `x-api-key` header. Access to private seller data or write operations additionally requires OAuth 2.0 scopes. The hub supports OAuth PKCE, refresh, retries and rate limits. To authorize your shop:

~~~bash
etsyctl oauth start --shop main --redirect https://your-registered-callback.example/oauth/callback
etsyctl oauth complete --state STATE --code CODE
~~~

The hub verifies ownership of the configured shop after OAuth. Do not copy refresh tokens from other programs that rotate them.

For local HTTP:

~~~bash
ETSY_HUB_CONFIG=/absolute/path/config.json node src/server.mjs
~~~

The service binds to **127.0.0.1** by default and refuses external binds without an internal bearer token. For remote use, add authenticated TLS and appropriate access controls. Existing remote MCP OAuth supports a private, owner-approved ChatGPT client, not general third-party seller sign-in.

The public self-hosted MCP exposes **79 tools in full mode**. Set `ETSY_MCP_READ_ONLY=1` to expose only 53 tools annotated read-only. To enable writes, remove the read-only variable, grant the necessary Etsy OAuth write scopes and reauthorize your own shop. [Full-access steps](docs/QUICKSTART.md#enable-full-shop-management-optional). This is an additional tool filter, not a substitute for Etsy OAuth permissions. Typed listing, inventory and media writes create backups where supported; **raw API writes have no automatic snapshots**. Confirm any live modification before giving an AI client write access.

### Docker

~~~bash
docker build -t etsy-seller-mcp-hub:local .
docker run --rm --name etsy-seller-mcp-hub -p 127.0.0.1:3737:3737 -v /absolute/etsy-data:/data:rw -e ETSY_HUB_CONFIG=/data/config.json etsy-seller-mcp-hub:local
~~~

Inside Docker, set `server.host` to `0.0.0.0` and configure a nonempty `server.auth_token_file`, otherwise startup will reject external binding. Expose the host port only on localhost or behind authenticated HTTPS. The Dockerfile runs as a non-root user.

## Development

~~~bash
npm run check
npm test
npm pack --dry-run --ignore-scripts
~~~

Tests use mocks and do not write to a live shop. See [Contributing](CONTRIBUTING.md), [Security](SECURITY.md) and the [MIT license](LICENSE).

© 2026 Bl0ck154. Independent open-source software for authorized Etsy seller integrations.

Multipart media uploads are limited to 64 MiB of decoded files per request by default. Configure ETSY_HUB_MAX_UPLOAD_BYTES (bytes, maximum 192 MiB) for larger files. Local file-path multipart uploads now stream in 64 KiB chunks; base64 JSON uploads from remote MCP remain buffered and size-limited.
