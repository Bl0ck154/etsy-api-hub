# Roadmap

## This branch (0.2.0 development)

- Public README, contributor guide and MIT license
- Local stdio MCP entrypoint for AI desktop clients
- Fail-closed external HTTP bind requirement
- Security boundary tests and GitHub Actions CI
- Publishable npm manifest, Dockerfile and repository visuals

## Not implemented yet

- Tenant-isolated OAuth for unrelated Etsy sellers
- Standards-based remote OAuth for additional third-party clients
- Per-tool authorization scopes and confirmation policies
- Resource-bounded large-file uploads without base64-in-JSON overhead
- Live end-to-end Etsy staging fixtures and publicly published npm/Docker packages
- MCP Registry and third-party directory listings

This repo is designed for a trusted owner and stores Etsy OAuth credentials server-side. Do not run it as an unrestricted shared public service.
