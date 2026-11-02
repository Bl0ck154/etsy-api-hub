<div align="center"><img src="assets/etsy-mcp-hub.svg" alt="Etsy MCP Hub" width="100%"></div>

# Etsy MCP Hub

Self-hosted Etsy Open API v3 toolkit for managing your own Etsy shop with AI assistants, scripts and applications. **77 MCP tools**, a command-line interface, a local HTTP API and a private ChatGPT MCP connector share one integration layer.

[Quick start](#quick-start) · [Connect AI clients](docs/MCP.md) · [Security](SECURITY.md) · [Architecture](docs/ARCHITECTURE.md) · [Roadmap](docs/ROADMAP.md)

> Independent open-source project. Not affiliated with or endorsed by Etsy. You must use your own approved Etsy API credentials and access only shops you are authorized to manage.

## Features

| Interface | Who it is for | Status |
| --- | --- | --- |
| **MCP via stdio** | Claude Desktop, Cursor and other local MCP clients | Implemented |
| **Remote MCP via HTTPS** | Private ChatGPT owner integration | Implemented, owner-only |
| **CLI / etsyctl** | Server agents, scripts, maintenance | Implemented |
| **HTTP API** | Local apps and backend services | Implemented |
| **GPT Actions** | Custom GPT read/write actions | Implemented |
| **Multi-user SaaS** | Unrelated Etsy sellers on one shared service | Not supported |

Operations include listings, images, videos, digital files, inventory, personalization, orders, transactions, reviews, shipping, payment and shop data. When a current endpoint is missing from the typed tools, use etsy_request_read, etsy_request_write or etsy_request_multipart to call the Etsy /v3/application API directly.

### Example prompts

- “List active products and show which have low inventory.”
- “Summarize paid orders from this week.”
- “Read the personalization requirements for this listing.”
- “Upload this image to listing 123456789.” *(write access and approval required)*
- “Update these selected listings once I review the changes.” *(live changes)*

The MCP server supplies capabilities and API data; the AI client provides the reasoning. Set ETSY_MCP_READ_ONLY=1 in a local client configuration to expose only read-only tools.

## Quick start

**Requires Node.js 22+** and your own Etsy Open API v3 application. The package currently has no runtime npm dependencies.

~~~bash
git clone https://github.com/Bl0ck154/etsy-api-hub.git
cd etsy-api-hub
cp config.example.json /tmp/etsy-hub-config.json
# Edit shop_id, credential_file paths and backup paths in the copied JSON.
export ETSY_HUB_CONFIG=/tmp/etsy-hub-config.json
node bin/etsyctl.mjs shops
~~~

The configuration example uses Linux paths under /etc and /var/lib. Set absolute paths appropriate for your machine. Do not commit credential files. [credentials.example.json](credentials.example.json) lists credential fields.

To run the **local MCP server**, install the local command and configure your desktop client:

~~~bash
npm link
etsy-mcp
~~~

[Claude Desktop / Cursor configuration](docs/MCP.md). The npm package is prepared for publication. Until the npm listing is verified, install from GitHub source.

### CLI examples

~~~bash
etsyctl listing list active --limit 100
etsyctl listing get 1234567890
etsyctl inventory get 1234567890
etsyctl orders list --limit 20 --paid true
etsyctl personalization get 1234567890
etsyctl images list 1234567890
etsyctl request GET /application/shops/12345678/sections
~~~

Etsy API credentials are required for real shop reads. The command `etsyctl shops` only checks configured shop aliases.

## Auth and API

The client supports OAuth 2.0 PKCE, token refresh, 401 recovery, retry-on-429 with bounded backoff, and rate-limit metadata. To authorize a new shop with its own token chain:

~~~bash
etsyctl oauth start --shop main --redirect https://your-registered-callback.example/oauth/callback
etsyctl oauth complete --state STATE --code CODE
~~~

OAuth completion verifies the authorized account owns the configured shop. Never copy refresh tokens from an existing application that still rotates them.

### HTTP API

~~~bash
ETSY_HUB_CONFIG=/absolute/path/config.json node src/server.mjs
~~~

Routes include GET /health, GET /v1/shops, POST /v1/request, POST /gpt/read, POST /gpt/write, GET /gpt/openapi.json and POST /mcp.

The server listens on **127.0.0.1** by default. It refuses to bind externally without a nonempty configured bearer token. For any remote connection, use TLS, a trusted reverse proxy and access controls. The remote OAuth connector currently accepts only an owner-approved ChatGPT client. For Claude Desktop and Cursor, use the local stdio interface.

### Docker

~~~bash
docker build -t etsy-mcp-hub:local .
docker run --rm --name etsy-mcp-hub   -p 127.0.0.1:3737:3737   -v /absolute/etsy-data:/data:rw   -e ETSY_HUB_CONFIG=/data/config.json   etsy-mcp-hub:local
~~~

Set server.host to 0.0.0.0 **inside the Docker config** and configure server.auth_token_file to a nonempty token file, otherwise it correctly refuses to bind. Make the volume files accessible to the container's non-root user. Keep the published host port on localhost or behind authenticated HTTPS.

## Safety and compatibility

Friendly listing, inventory, personalization and media write commands create backups where supported. Generic raw API writes do **not** automatically create listing snapshots. Review operations and permissions before allowing an agent to modify live Etsy data.

Etsy supports up to **20 images and 2 short videos** on a listing. The Hub normalizes listing_type/type discrepancies, validates personalization constraints before writes, and supports the current inventory variation parameter.

## Development

~~~bash
npm run check
npm test
npm pack --dry-run --ignore-scripts
~~~

The test suite uses mocks and does not perform live Etsy writes. [Contributions](CONTRIBUTING.md) and responsible security reports are welcome.

## Install from npm (once published)

After confirming the version is live at [npm](https://www.npmjs.com/package/etsy-api-hub), use:

~~~bash
npm install -g etsy-api-hub
ETSY_HUB_CONFIG=/absolute/path/config.json ETSY_MCP_READ_ONLY=1 etsy-mcp
~~~

The npm name is `etsy-api-hub` and the MCP server's registry name is `io.github.bl0ck154/etsy-mcp-hub`. Etsy shop credentials are never included in the published package.

MIT License © 2026 Bl0ck154. Etsy and associated marks belong to their respective owners.
