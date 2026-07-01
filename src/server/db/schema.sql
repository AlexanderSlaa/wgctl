CREATE TABLE IF NOT EXISTS peers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  label         TEXT NOT NULL UNIQUE,
  public_key    TEXT NOT NULL UNIQUE,
  preshared_key TEXT,
  tunnel_ip     TEXT NOT NULL UNIQUE,
  routes        TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tracks one-time join token hashes. Key "join_token_hash:<sha256>" records
-- that the token with that hash has been consumed and must not be accepted again.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
