# Security and hosting boundaries

## Who should host this MCP?

**Recommended:** each seller runs a local copy or a self-hosted copy in their own account with their own approved Etsy v3 application. Etsy credentials, orders and OAuth refresh tokens stay in the seller's custody.

**Not offered:** a shared, public multi-tenant Etsy MCP endpoint that accepts arbitrary seller logins. This repo has **no tenant-isolated OAuth**, public client registration for unrelated users, per-seller storage partitions, or end-user onboarding SaaS controls.

MCP is a protocol and does not confer Etsy commercial access. A shared service that authenticates other sellers under one developer's Etsy application requires an Etsy approval suitable for that use case, a server-side security review, isolated encryption and access controls, and privacy compliance. Even with all of these, users must consent explicitly. We do not recommend asking customers to send their Etsy keystring, shared secret, refresh tokens or account password to the maintainer.

## Data flow (local mode)

Seller's AI client -> local stdio `etsy-mcp` -> local `EtsyHub` -> Etsy Open API v3. Only authorized HTTPS requests go to Etsy. API keys and OAuth tokens are loaded from local credential files; they are not returned in tool responses.

Prompts and tool results **may be sent to the AI assistant's model provider**, depending on the client's policies. Read-only mode stops writes through MCP, but read-only **orders and customer data may still be sensitive**. Limit what you request and review your AI provider's data handling terms.

## Layers of protection

- `ETSY_MCP_READ_ONLY=1` filters **write tools** from stdio MCP. This is an application-layer filter; it does not reduce Etsy OAuth scopes by itself.
- `etsyctl init` defaults to only the `shops_r`, `listings_r`, `transactions_r` OAuth scopes. For writes, explicitly add the necessary scopes and reauthorize.
- Safe typed writes create snapshots where supported. **Raw `etsy_request_write` and multipart operations are powerful and do not guarantee snapshots.**
- The local HTTP gateway binds to `127.0.0.1` by default. External binding requires an access token; publish only behind appropriate authenticated TLS.
- The remote OAuth bridge is currently approved-owner-only. **Do not modify it into a generic public seller connector without tenancy and authorization redesign.**
- Credential files created by the setup assistant are private (`0600` on POSIX); credentials never belong in Git. Keep separate rotating refresh token chains for independent consumers.
- Reports return limited data. The paid/unshipped report deliberately omits buyer names, emails and shipping addresses.

## What Glama and directories may safely do

Public directories may clone, build, and inspect source metadata or introspect a server using **synthetic test configuration without real Etsy API credentials**. Do not upload actual Etsy credentials, tokens or order responses to directory scanners. Listing as a **source-code MCP server** is different from offering a live shared connector.

## Threat model / known gaps

- Remote public multi-tenant OAuth and client registration: **unsupported**.
- End-to-end live Etsy API tests: **not part of public CI**; tests are mocked to avoid accessing real shops.
- Local API read access: can still reveal buyer data. Choose least-privilege scopes and controls.
- Large media: base64 uploads consume extra memory; streaming uploads remain future work.
- Filesystem compromise: local credentials are readable by processes running as the seller's OS user. Use OS protections and full disk encryption.

Please see [SECURITY.md](../SECURITY.md) to report a vulnerability privately.

For tested mitigations and outstanding quality gates, see [Security review](SECURITY-REVIEW.md).
