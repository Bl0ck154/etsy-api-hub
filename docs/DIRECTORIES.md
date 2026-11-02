# Open-source directory submission

Our package is listed on [npm](https://www.npmjs.com/package/etsy-seller-mcp-hub) and the [official MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=etsy-seller-mcp-hub).

## Glama listing: already published

Our server has a [Glama profile](https://glama.ai/mcp/servers/Bl0ck154/etsy-seller-mcp-hub). The live score badge is available at:

`https://glama.ai/mcp/servers/Bl0ck154/etsy-seller-mcp-hub/badges/score.svg`

The badge displays A and indicates that the maintainer has claimed the listing. It is linked from our README and [upstream awesome-mcp-servers PR #18306](https://github.com/punkpeye/awesome-mcp-servers/pull/18306). Do not submit a duplicate server.

Glama currently says the source server **cannot be deployed on Glama**. The package is nonetheless available through npm and the official MCP Registry. Shared hosted deployment is intentionally out of scope: sellers self-host with their own credentials.

`Dockerfile.glama` uses synthetic, no-credential introspection. Never provide OAuth secrets or customer data to a directory scanner. The upstream PR remains open until external maintainers merge it. A directory score is not an independent security certification.

## Other possible catalogues

After Glama, consider Smithery and mcp.so if they accept self-hosted stdio servers. Describe this as source code installed per seller, **not** as a public, shared remote connector.

## Outreach and community

Use accurate examples from [DEMO.md](DEMO.md) with fictional data only. Ask technical sellers for feedback on ease of setup, OAuth and first useful tasks. Do not buy stars or simulate testimonials.
