# Security policy

Report security issues through GitHub private vulnerability reporting, if available, or contact the repository owner privately. Do not publish active credential exploits.

Read [Security boundaries](docs/SECURITY-BOUNDARIES.md) before self-hosting. Do not send Etsy credentials to this repository's maintainer.

## Deployment

- The HTTP server binds to 127.0.0.1 by default. A non-loopback bind requires a configured nonempty bearer token.
- Remote public_base_url must use HTTPS. Use a trusted reverse proxy with additional access controls.
- Remote MCP OAuth in this project is **owner-only** and currently limited to the approved ChatGPT client. It is not multi-tenant.
- Set ETSY_MCP_READ_ONLY=1 for local stdio MCP to expose only tools marked read-only.
- Local stdio MCP inherits access to the credentials of the current operating-system user. Do not provide it to untrusted users or processes.
- MCP JSON requests default to a 64 MiB size cap; adjust ETSY_MCP_MAX_BODY_BYTES if necessary, up to 192 MiB. Base64 file uploads can consume significantly more memory than file size.\n- Raw write operations do not necessarily create listing backups. Review destructive actions in your AI client.
- Store credential files with restricted permissions (0600), never in Git. Use separate token chains for independently rotating consumers.

Security fixes target the latest main branch; this project is pre-1.0.
