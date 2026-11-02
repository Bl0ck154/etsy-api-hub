# MCP client setup

## Claude Desktop / Cursor (local stdio)

Clone this repository, configure your own Etsy credentials and create an ETSY_HUB_CONFIG JSON file. Run `npm link` inside the cloned repository to install the `etsy-mcp` command. If your client has a user-specific executable search path, use an absolute path to the project script.

Example MCP client configuration:

~~~json
{
  "mcpServers": {
    "etsy": {
      "command": "node",
      "args": ["/absolute/path/to/etsy-api-hub/bin/etsy-mcp.mjs"],
      "env": {
        "ETSY_HUB_CONFIG": "/absolute/path/to/config.json"
      }
    }
  }
}
~~~

The local stdio server reads newline-delimited JSON-RPC on stdin and sends responses on stdout. Credentials remain on your own machine. The AI client can request write operations, so configure its approval settings. For read-only access, add "ETSY_MCP_READ_ONLY": "1" to the client env configuration.

## ChatGPT (remote, owner-only)

The existing remote HTTP endpoint is /mcp, with OAuth discovery under /.well-known/ and /oauth/. It intentionally validates a specific ChatGPT client and requires the owner's password. This flow is private, not a shared sign-in system for unrelated sellers.

Use an HTTPS reverse proxy, a configured server.auth_token_file and server.public_base_url before exposing the endpoint. Do not give other people access to your owner's instance.

## Missing functionality

A generic multi-user OAuth platform, tenant-isolated credentials and broad non-ChatGPT remote OAuth support are not yet implemented. Use the local stdio mode for other AI clients rather than weakening the production owner's OAuth restrictions.

## Security

Read-only tools are suitable for exploratory prompts. Review write requests before approving them. The generic etsy_request_write and etsy_request_multipart tools expose broad Etsy API functionality and may not automatically save listing backups.
