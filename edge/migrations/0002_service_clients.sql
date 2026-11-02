-- Distinct credentials for each backend project. Store only SHA-256 of random 256-bit bearer.
CREATE TABLE IF NOT EXISTS hub_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL,
  shops TEXT NOT NULL,
  path_prefixes TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS hub_clients_active ON hub_clients(revoked_at);
