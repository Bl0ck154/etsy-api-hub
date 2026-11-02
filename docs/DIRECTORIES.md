# Open-source directory submission

Our package is listed on [npm](https://www.npmjs.com/package/etsy-seller-mcp-hub) and the [official MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=etsy-seller-mcp-hub).

## Glama listing

Glama requires the **repository maintainer** to authenticate with GitHub and submit their repository to its [MCP server directory](https://glama.ai/mcp/servers). Submit:

- Repository: `https://github.com/Bl0ck154/etsy-seller-mcp-hub`
- Name: `Etsy Seller MCP Hub`
- Description: `Self-hosted Etsy Open API v3 MCP server for shop owners: 79 tools, safe onboarding, read-only stock and order reports, CLI and OAuth.`
- A source-controlled test Dockerfile is at `Dockerfile.glama`.

Glama may require a Dockerfile upload to execute its health checks. `Dockerfile.glama` uses **synthetic config only**. The process can initialize and advertise tools without seller credentials; it cannot use live Etsy APIs. **Never upload real OAuth tokens or customer data** to a directory/registry service.

After Glama accepts and scores the project, add the verified score badge to the existing [awesome-mcp-servers PR #18306](https://github.com/punkpeye/awesome-mcp-servers/pull/18306), using Glama's **actual** server URL, not a guessed one. The upstream bot currently requires a score badge. Do not publish a fake/unverified quality score.

The official Registry package may be automatically indexed over time, but that does not substitute for Glama's own ownership and health checks.

## Other possible catalogues

After Glama, consider Smithery and mcp.so if they accept self-hosted stdio servers. Describe this as source code installed per seller, **not** as a public, shared remote connector.

## Outreach and community

Use accurate examples from [DEMO.md](DEMO.md) with fictional data only. Ask technical sellers for feedback on ease of setup, OAuth and first useful tasks. Do not buy stars or simulate testimonials.
