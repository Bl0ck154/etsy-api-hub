# Architecture

## Dependency direction

    agents ----------------> etsyctl --------+
                                             |
    internal projects -----> local HTTP -----+--> EtsyHub --> EtsyClient --> TokenFileStore --> Etsy Open API v3
                                             |
    future GPT/MCP --------> adapter --------+

Future GPT Actions, MCP servers, or app-specific adapters must call into this Hub instead of copying Etsy auth logic.

## Separation from legacy Etsy Manager Pro

`etsy-manager-pro` contains a useful historical implementation, but it mixes Etsy transport with GPT OAuth, GPT action schemas, role scopes, draft-only policy and app UI concerns.

The Hub deliberately keeps only Etsy integration concerns:

- shop registry;
- Etsy credentials;
- access-token refresh;
- safe Etsy host/path construction;
- retries/rate limits;
- reusable operations;
- audit metadata;
- backups for friendly mutation commands.

No dependency on Etsy Manager Pro is permitted.

## Full API model

High-level methods exist for frequent tasks, but they are not a capability boundary.

`EtsyClient.request()` accepts any `/application/*` path and GET/POST/PUT/PATCH/DELETE. This makes the Hub forward-compatible with Etsy endpoints that are not wrapped yet while still preventing host injection.

## Credentials

Credential material never belongs in git.

The long-term source of truth is a Hub-owned credential directory with mode `0700`, individual credential files mode `0600`, and a dedicated service identity.

During migration, config may reference an existing token file owned by another project. That is transitional only; do not create a second independently refreshed copy of the same token until the old consumer is migrated.

## Consumer policy

The Hub does not encode ChatGPT/GPT-specific approval logic. A consumer may impose its own authorization/confirmation UX, but that belongs above the Hub.

- Hub: what Etsy can do.
- Consumer: what this caller/user is currently allowed or intended to do.
