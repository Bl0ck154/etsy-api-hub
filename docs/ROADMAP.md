# Roadmap

## Shipped in v0.3.1

- Public npm package and official MCP Registry entry
- Seller-focused README, MIT license, CI and security instructions
- Shared Etsy Open API v3 client, OAuth PKCE, safe listing mutation snapshots
- Local stdio MCP (77 tools), CLI, local HTTP, private owner-only remote bridge
- GitHub Releases and manual, OIDC-backed MCP Registry publishing

## Working toward the next release (unreleased)

- Local onboarding with `etsyctl init` and offline diagnostics with `etsyctl doctor`
- Seller read-only reports for low inventory and paid/unshipped orders
- Additional security and mocked tests, setup docs, safe demo examples
- Correct quick-start instructions and clarify the self-hosted security boundary

## Shipped in v0.4.1

- Existing Glama listing and verified A-rated badge connected to README and upstream PR
- Bounded pagination for seller low-stock and unshipped reports with `next_offset`
- Safe setup rollback if the credential placeholder cannot be created
- Additional pagination, data minimization and configuration safety regression tests

## Current limitations

- Glama lists the server but cannot deploy it as a shared hosted connector.
- The awesome-mcp-servers PR awaits external maintainer review and merge.
- No independent live Etsy end-to-end validation in public CI.
- Every seller still needs an approved v3 API key and OAuth setup.

## Future candidates

- Multi-page low-stock inventory reporting using Etsy batch inventory API, with careful rate limiting and missing-record handling
- More seller-specific reports only after validating API schemas and scope requirements
- Stream/bound large file uploads without base64 JSON memory spikes
- Better non-ChatGPT MCP clients using local stdio and reliable OS-specific installation help
- CI integration tests with **synthetic** configuration and no customer credentials
- Follow up with upstream maintainers on the existing Glama-badged PR

## Explicitly outside current scope

- Hosting a shared multi-seller SaaS MCP endpoint or accepting strangers' Etsy tokens
- Live customer Etsy writes in public CI
- Unlimited remote MCP login without per-user authorization and tenant isolation

See [Security boundaries](SECURITY-BOUNDARIES.md).

## v0.4.2 - upload memory safeguards

- Aggregate size limit for multipart local paths, byte buffers and base64 before allocation.
- Seven new regression tests; true streaming remains open.
