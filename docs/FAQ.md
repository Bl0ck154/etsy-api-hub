# Frequently asked questions

## Is this a public Etsy MCP service?

No. Etsy Seller MCP Hub is self-hosted open-source software. Install it on your own machine or private server. The owner-only remote bridge is not for unrelated Etsy sellers.

The [Glama profile](https://glama.ai/mcp/servers/Bl0ck154/etsy-seller-mcp-hub) catalogs the repository, not a shared Etsy login. The profile currently says Glama cannot deploy it.

## Do I have to send you my Etsy API credentials?

No. Never send Etsy keystrings, secrets, authorization codes, refresh tokens or passwords to the maintainer, GitHub issues, or Glama. Configure your local credentials using [Quick Start](QUICKSTART.md). Note that your own AI model provider may receive tool results, depending on the client.

## Can I use an old Etsy API key?

An existing approved Etsy Open API v3 key can work if the shop grants the necessary OAuth 2.0 scopes. See [Access types](ACCESS.md). OAuth 1.0 tokens cannot be reused unchanged.

## Is read-only absolutely safe?

`ETSY_MCP_READ_ONLY=1` filters write tools from the local MCP interface; it does not erase broader Etsy OAuth scopes or prevent other local programs from using the same credentials. Use least-privilege scopes and keep the local account secure.

## How do I inspect all of my listings for low stock?

The report reads at most 25 active listings per request. If the response contains `next_offset`, pass it as `--offset` for the next page. Iterate until it is null. `flagged_count` refers only to that page, not the whole shop.

## Why are buyer emails missing from the unshipped order report?

The report intentionally strips buyer names, emails, messages and mailing addresses to minimize personal data sent to an AI model. Other raw tools can return more data subject to Etsy scopes.

## Do writes require approval?

The Hub provides API capabilities, not its own end-user approval UI. Keep the MCP in read-only mode during exploration; explicitly review and approve writes in your AI client. Typed listing operations create backups where supported, but generic raw write calls do not guarantee them.

## Does the Glama A badge guarantee security?

No. It reflects Glama's current automated rating and that the listing is maintainer-claimed; it is not a formal penetration test, privacy audit, or live Etsy validation.

## Where is the latest version?

See the [npm package](https://www.npmjs.com/package/etsy-seller-mcp-hub) and [GitHub releases](https://github.com/Bl0ck154/etsy-seller-mcp-hub/releases).

## Are large media uploads supported?

Total files in one upload request are limited to 64 MiB by default; configure ETSY_HUB_MAX_UPLOAD_BYTES to a positive integer up to 201326592. Local file-path multipart uploads stream in 64 KiB chunks. MCP base64 JSON files remain size-limited and buffered.

## Can remote MCP refresh tokens be replayed?

The owner-only bridge rotates refresh tokens on first use, rejecting any consumed token even after restart. No public multi-seller login is provided, and there is not yet a dedicated revoke-all-sessions control.
