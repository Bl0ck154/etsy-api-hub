# Security review status

Reviewed against v0.5.0 source code. This is an internal code review backed by mocked tests, **not** a certified independent security audit or a live Etsy penetration test.

| Area | Evidence and mitigation | Remaining gap |
| --- | --- | --- |
| Seller account isolation | Every seller self-hosts local credentials; remote MCP stays owner-only | Multi-tenant hosting intentionally unsupported |
| OAuth PKCE state | Random state and S256 challenge, 15-minute expiration, atomic one-use claim before token exchange | No independent Etsy live callback validation yet |
| OAuth permissions | New setups and no-scopes fallback request shops_r/listings_r/transactions_r | Write scopes must be explicitly added and reauthorized |
| Etsy API and OAuth errors | Upstream error text, arbitrary JSON error bodies and error codes are not sent to downstream clients | Errors are less descriptive; inspect numeric HTTP status and private logs without credentials |
| Token refresh | Token store uses an inter-process refresh lock, private credential files and atomic writes | Remote signed refresh tokens are now one-time with persisted SHA-256 fingerprints; no central revoke-all or verified live migration yet |
| Read-only MCP | Writes hidden and blocked at local stdio boundary; tested | Does not revoke other programs' Etsy write scopes |
| Order data | Seller paid/unshipped summary excludes buyer names, emails and addresses | Other authorized raw tools can return sensitive seller data |
| Upload memory | Aggregate decoded payload limit, size checks before file read/base64 conversion | Local file paths now stream in 64 KiB chunks; base64 JSON remains buffered |
| Remote HTTP | Auth token required for non-loopback binding; HTTPS required for remote public URL | Independent deployment and reverse proxy audit outstanding |
| Packaging | CI, npm provenance, official MCP Registry metadata, live npm smoke-install | Manual cross-platform test matrix added; independent OAuth onboarding still unverified |

Owner-approved live draft CRUD has been verified through the separately connected Cloudflare Etsy_API provider. This does not prove first-time OAuth onboarding or an independent audit. The private My_Etsy remote MCP still requires second-shop OAuth reconciliation; see [Connectors](CONNECTORS.md).\n\nUse only synthetic fixtures in public CI. Never upload seller tokens or customer records to a directory scanner or issue tracker. Do not expose the owner-only remote MCP as a public multi-seller service.

Security concerns can be reported following [SECURITY.md](../SECURITY.md).
