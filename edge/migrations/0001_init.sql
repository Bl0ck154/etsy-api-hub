-- Etsy API Hub edge. Never put raw access/refresh tokens in SQL: sealed payloads only.
CREATE TABLE IF NOT EXISTS hub_tokens (
  alias TEXT PRIMARY KEY,
  sealed TEXT NOT NULL,
  lease_owner TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hub_oauth (
  state TEXT PRIMARY KEY,
  alias TEXT NOT NULL,
  verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hub_snapshots (
  id TEXT PRIMARY KEY,
  alias TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  sealed TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hub_snapshots_listing ON hub_snapshots(alias, listing_id, at);
CREATE TABLE IF NOT EXISTS hub_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  alias TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER,
  operation TEXT,
  ok INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hub_audit_time ON hub_audit(at);
CREATE TABLE IF NOT EXISTS mcp_client (
  client_id TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mcp_codes (
  code TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  challenge TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mcp_refresh (
  jti TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mcp_failures (
  ip TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  until INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_lock (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  client_id TEXT NOT NULL,
  at INTEGER NOT NULL
);
