# Connect Etsy Seller MCP Hub to AI clients

First run [Quick Start](QUICKSTART.md). An Etsy Open API v3 key and OAuth authorization are needed for live shop operations.

## Claude Desktop

Install: `npm install -g etsy-seller-mcp-hub`. Open Settings → Developer → Edit Config and add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "etsy-seller": {
      "command": "etsy-mcp",
      "env": { "ETSY_MCP_READ_ONLY": "1" }
    }
  }
}
```

Restart Claude Desktop. If `etsy-mcp` is not on the app's PATH, replace `command` with its absolute path (from `which etsy-mcp` on macOS/Linux or `where.exe etsy-mcp` on Windows). JSON Windows paths must use forward slashes or double backslashes.

## Cursor

Open Cursor MCP settings or `.cursor/mcp.json` and use the same `mcpServers` JSON. For a non-default config, add `ETSY_HUB_CONFIG` with the absolute path. Restart the client.

## VS Code

Use the `MCP: Add Server` command or your workspace MCP configuration:

```json
{
  "servers": {
    "etsy-seller": {
      "type": "stdio",
      "command": "etsy-mcp",
      "env": { "ETSY_MCP_READ_ONLY": "1" }
    }
  }
}
```

## Without a global install

The npm package has two executables, so bare `npx -y etsy-seller-mcp-hub` can be ambiguous. Run the explicit binary:

```bash
npx --yes --package=etsy-seller-mcp-hub etsy-mcp
```

In AI client JSON you can use `"command": "npx"` and `"args": ["--yes", "--package=etsy-seller-mcp-hub", "etsy-mcp"]`, or install globally and use the binary path.

## Switch from read-only to full seller tools

The examples above set `ETSY_MCP_READ_ONLY=1` and display 53 read-only tools. For all 79 tools, remove the `ETSY_MCP_READ_ONLY` variable, or set it to `"0"`, then restart the client. **This changes tool visibility, not Etsy authorization.** To create or edit items, grant the appropriate Etsy OAuth write scopes and reauthorize your own shop. See [Full shop management](QUICKSTART.md#enable-full-shop-management-optional).

## Security and troubleshooting

Local MCP exposes 79 tools, with 53 in read-only mode. The read-only tool filter does not change Etsy OAuth scopes. Shop content returned by MCP may be transmitted to your AI model provider; choose appropriate client privacy settings.

- `spawn ENOENT`: set the absolute path to the installed binary.
- Server won't start: run `etsyctl doctor` and check `ETSY_HUB_CONFIG`.
- Tool list loads but real data fails: fix Etsy credentials or OAuth scopes. `tools/list` does not call Etsy.
- Callback mismatch: Etsy requires an exact registered HTTPS redirect URI.
- Changed OAuth scopes: reauthorize via Etsy.

## ChatGPT: remote owner-only bridge

The optional remote `/mcp` endpoint is designed for one approved ChatGPT client and an owner's password. It is **not** a public seller login system and has no tenant isolation. Do not share your Etsy credentials with a stranger's hosted MCP. For alternatives, use local stdio with your own account, or self-host your own private HTTPS deployment with authentication.

Read [Security boundaries](SECURITY-BOUNDARIES.md).
