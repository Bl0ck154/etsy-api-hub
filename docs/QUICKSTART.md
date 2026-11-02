# Quick start: connect your own Etsy shop

**Audience:** Etsy sellers and developers operating their own local MCP server. This project is not a hosted Etsy sign-in service; you keep credentials on your computer.

## Requirements

- Node.js 22 or newer.
- An Etsy shop and your own approved Etsy Open API v3 application (an existing approved Personal Key works; see [access requirements](ACCESS.md)).
- Etsy app **keystring**, **shared secret**, your numeric **shop ID**, and an exactly matching HTTPS callback URL registered in the Etsy developer portal.

Etsy requires OAuth PKCE for private shop data. The CLI handles PKCE and refresh tokens for you. Never post your keystring, shared secret, or OAuth tokens in issues or online forms.

## 1. Install and create a local configuration

```bash
npm install -g etsy-seller-mcp-hub
etsyctl --help
etsyctl init --shop-id 12345678
etsyctl doctor
```

Replace the example shop ID with your actual numeric shop ID. `init` creates two new private files in your user home directory (it refuses to overwrite existing files):

- macOS/Linux: `~/.config/etsy-seller-mcp-hub/config.json` and `credentials.json`
- Windows: `%USERPROFILE%/.config/etsy-seller-mcp-hub/config.json` and `credentials.json`

You can choose custom paths with `etsyctl init --shop-id ID --config /absolute/path/config.json --credential-file /absolute/path/credentials.json`. For custom paths set `ETSY_HUB_CONFIG` for later commands. `init` sets read-only OAuth scopes (`shops_r`, `listings_r`, `transactions_r`) by default. The local credential file initially contains **empty placeholders**, never generated or borrowed Etsy secrets.

## 2. Enter your own API credentials locally

Open `credentials.json` in a local text editor and set:

```json
{
  "client_id": "YOUR_OWN_ETSY_KEYSTRING",
  "secret": "YOUR_OWN_ETSY_SHARED_SECRET",
  "access_token": "",
  "refresh_token": ""
}
```

Keep the credential file private (on Unix: `chmod 600 ~/.config/etsy-seller-mcp-hub/credentials.json`). Do not place tokens in shell arguments or Git.

Run `etsyctl doctor` again. A missing OAuth token should now show a warning, not a failure. `doctor` is intentionally **offline**: it verifies local file configuration but cannot prove the Etsy app is approved.

## 3. Authorize your own shop

Register an exact HTTPS callback URL in Etsy Developer Portal and use that identical string when starting OAuth. Etsy rejects changes in scheme, case, path or trailing slash.

```bash
etsyctl oauth start --shop main --redirect https://your-registered-callback.example/callback
```

The output contains `authorization_url` and `state`. Open the URL in a browser, sign in to Etsy, and approve the scopes for **your own shop**. After Etsy redirects to the registered callback, obtain the `code` and `state` query parameters from the redirected URL. The callback must be under your control. If you do not operate a callback handler, an HTTPS callback that displays a harmless page can still expose the code in the URL, but the URL and its query parameters are sensitive; never paste them into a public chat or issue. Etsy requires the callback to be registered before use.

```bash
etsyctl oauth complete --state YOUR_STATE --code YOUR_CODE
etsyctl doctor
etsyctl shops
etsyctl listing list active --limit 5
```

The code is single-use, and the state expires. Authorization completion verifies the shop ID matches your configured shop. Treat code and state as temporary credentials. For a Windows shell, enter the commands individually, without leading `$` characters.

If you later need write operations, deliberately modify `oauth_scopes` and **reauthorize**. Always approve live changes in your AI assistant.

## 4. Connect a local AI assistant

Choose the [MCP client instructions](MCP.md) for Claude Desktop, Cursor or VS Code. For most clients the standard local config is:

```json
{
  "mcpServers": {
    "etsy-seller": {
      "command": "etsy-mcp",
      "env": { "ETSY_MCP_READ_ONLY": "1" }
    }
  }
}
```

Supply the absolute path if the executable is not on your AI client's PATH. For `npx` setup and Windows-specific paths, see [MCP.md](MCP.md). Never connect to another seller's remote MCP URL.

## 5. First useful prompts

- "List my five newest active Etsy listings."
- "Show paid but unshipped orders, using only order IDs and timestamps."
- "Review 10 active listings and flag variants with stock of 3 units or less."
- "Find the listing with this ID and show its current personalization options."

CLI alternatives:

```bash
etsyctl report low-stock --limit 10 --threshold 3
etsyctl report unshipped --limit 20
```

Low-stock checks at most 25 listings per call to limit Etsy API usage. Some listings have no inventory records. Reports never modify shop data.

## Troubleshooting

- `etsyctl doctor` says `api_key` fail: enter your own approved keystring and shared secret in the local file.
- `oauth` warning: finish the OAuth consent; an API key alone cannot read private orders or inventory.
- Etsy `redirect_uri` error: compare the registered HTTPS URL byte-for-byte; trailing slash and case matter.
- Etsy `401/403`: verify app approval and OAuth scopes; reauthorization is required for changed scopes.
- AI client `spawn ENOENT`: use the absolute path to `etsy-mcp` instead of relying on PATH.
- AI client sees tools but API calls fail: `tools/list` does not require access to Etsy, but real shop operations do.
- Installing on a remote server: use a private user account and locally restricted credentials; never expose this owner-only MCP as an open public service.

For security trade-offs, read [Security boundaries](SECURITY-BOUNDARIES.md).
