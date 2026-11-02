# Roadmap

This is a seller-hosted MCP server. Any user operates their own instance with their own authorized Etsy API access. A shared public login service is not planned.

## Available today (v0.5.0)

- 79 MCP tools, of which 53 are read-only; local CLI, stdio and optional private HTTP.
- Own-shop OAuth PKCE, refreshing tokens, typed listing updates and backups where supported.
- Quick Start, offline setup diagnostics, stock and unshipped-order reports with paging.
- npm releases via short-lived GitHub OIDC, official MCP Registry listing, maintainer-claimed Glama profile with A badge.
- Input limits for multipart file uploads (64 MiB decoded-byte aggregate by default), mocked tests and CI.

## Next patch (v0.4.3)

- Consume each local Etsy OAuth PKCE state only once, even on failure or concurrent callbacks.
- Avoid returning raw Etsy HTTP/OAuth error bodies or reflected seller information in error messages.
- Default OAuth scopes and the example config to read-only; grant write scopes only deliberately.
- Expand offline security regression tests and publish the review findings.

## Delivered in v0.5.0

- Owner-only remote MCP one-time refresh tokens, durable replay prevention and expired-marker cleanup.
- Bounded multipart streaming for local file paths. Remote MCP base64 JSON stays capped and buffered.
- Tests for concurrent refresh, replay after restart, invalid tokens, streamed multipart, safe header validation and altered files.
- Manual cross-platform Windows, macOS and Linux GitHub Actions workflow.

## Verified quality evidence

- Public npm 0.5.0 installs cleanly and stdio MCP initialization and read-only tool discovery work in isolation.
- Mocked security tests and Linux, macOS and Windows CI matrix passed.
- Existing authorized Cloudflare Etsy_API provider completed a consented draft create/read/update/readback/delete in second; the draft was removed.
- The private My_Etsy remote connector still needs separate second-shop OAuth reconciliation; see [Connector status](CONNECTORS.md) and [issue #16](https://github.com/Bl0ck154/etsy-seller-mcp-hub/issues/16).
- Independent security certification and an unaided first-time OAuth onboarding exercise remain unverified.

## P1 — improvements with remaining work

- Optional remote base64 media handoff is not planned without a demonstrated need. Local file uploads already stream; base64 stays buffered and size-limited.
- Upstream [awesome-mcp-servers PR #18306](https://github.com/punkpeye/awesome-mcp-servers/pull/18306) remains open; our Glama badge and internal submission are complete.

## Out of scope

- A publicly shared multi-seller OAuth connector that collects other owners' tokens.
- Unrestricted remote third-party OAuth clients; the old optional enhancement was closed as not planned.
- Live Etsy writes in public CI, fabricated testimonials, or paid GitHub stars.

See [Security boundaries](SECURITY-BOUNDARIES.md) and [Security review](SECURITY-REVIEW.md).
