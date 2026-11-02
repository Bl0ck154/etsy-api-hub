# Contributing

Bug reports, documentation fixes and focused pull requests are welcome.

1. Open an issue before significant architecture changes.
2. Use Node.js 22+ and run `npm run check` and `npm test` before creating a PR.
3. Add tests for OAuth, authorization, input validation and new MCP tools.
4. Never call live Etsy write endpoints from CI. Use mock responses and sanitized fixtures.
5. Do not include buyer data, token files or other private shop information in code, logs, issues or PRs.

Keep typed tools on the shared EtsyHub transport. New endpoints can be called through the existing raw API interface until a typed tool is needed.
