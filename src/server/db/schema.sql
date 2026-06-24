CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS networks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  cidr          TEXT NOT NULL,
  description   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_network_access (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  network_id  INTEGER NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, network_id)
);

-- username is NOT a foreign key: the static peer row (is_static=1, migrated
-- from the pre-existing wg0.conf) intentionally uses a sentinel username
-- ("__static__") that has no corresponding row in `users` — it isn't a real
-- account, just a label for "this peer isn't managed via the API".
CREATE TABLE IF NOT EXISTS peers (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  username            TEXT NOT NULL,
  public_key          TEXT NOT NULL UNIQUE,
  preshared_key       TEXT,
  tunnel_ip           TEXT NOT NULL UNIQUE,
  advertised_subnets  TEXT NOT NULL DEFAULT '[]',
  network_ids         TEXT NOT NULL DEFAULT '[]',
  is_static           INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at        TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  username    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL
);
