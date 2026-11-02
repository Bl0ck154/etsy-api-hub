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

## P0 — proof of real-world readiness

- End-to-end read-only smoke test against a dedicated, consented Etsy test shop; no customer data in CI.
- Independent review of revocation/logout for remote OAuth; mock one-time refresh-token rotation has been added.
- Fresh install on Windows, macOS and Linux by an independent user.

Track evidence in [issue #16](https://github.com/Bl0ck154/etsy-seller-mcp-hub/issues/16).

## P1 — improvements with remaining work

- Live validation of bounded local-file streaming and possible remote media handoff ([issue #5](https://github.com/Bl0ck154/etsy-seller-mcp-hub/issues/5)).
- Upstream [awesome-mcp-servers PR #18306](https://github.com/punkpeye/awesome-mcp-servers/pull/18306) is awaiting its maintainers. Glama profile already exists; badge already added ([issue #13](https://github.com/Bl0ck154/etsy-seller-mcp-hub/issues/13)).

## Out of scope

- A publicly shared multi-seller OAuth connector that collects other owners' tokens.
- Unrestricted remote third-party OAuth clients; the old optional enhancement was closed as not planned.
- Live Etsy writes in public CI, fabricated testimonials, or paid GitHub stars.

See [Security boundaries](SECURITY-BOUNDARIES.md) and [Security review](SECURITY-REVIEW.md).
