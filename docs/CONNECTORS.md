# Etsy connectors: separate authorization stores

The owner operates two Etsy integrations. A shop alias in one connector does not mean the other connector has its OAuth tokens.

## Status, verified 2026-11-02

- Cloudflare Etsy_API provider: both main and second returned HTTP 200 for listings, inventory, and receipts.
- Private My_Etsy remote MCP / server-local CLI: both aliases are configured, and main reads work. Second fails with INVALID_CREDENTIAL_FILE. Its local credential file has app-key fields but lacks shop OAuth token fields.

Never copy OAuth tokens across the services blindly. Repair only the intended private connector using its approved authorization workflow, then verify that main still reads normally. Follow [issue #16](https://github.com/Bl0ck154/etsy-seller-mcp-hub/issues/16).

## Completed checks

- Public npm version 0.5.0 installed in a clean directory. Init generated a private config and credential placeholders; doctor correctly identified missing OAuth credentials.
- Stdio MCP initialize and tools/list succeeded using synthetic data and returned 53 read-only tools.
- The 78 project tests and the Linux, macOS and Windows portability matrix passed.
- An owner-approved disposable draft in second was created, read, edited, read back and deleted through Cloudflare Etsy_API. No active listing or customer order was touched.

These checks do not prove fresh real-world OAuth onboarding, an independent security audit, or a live upgrade of the existing private MCP service. No production OAuth tokens were changed.

## Troubleshooting

1. Establish which connector is being used, Cloudflare Etsy_API or the private My_Etsy MCP.
2. Enumerate shop aliases through that same connector.
3. Make a read-only listing request for main and second.
4. If second is missing credentials, use that connector's approved account authorization flow. Avoid moving secrets between services or exposing them in logs.
5. Confirm both aliases after the approved fix.

The public project remains self-hosted, with each seller holding their own Etsy application credentials.
