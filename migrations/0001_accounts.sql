CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  login_hash TEXT NOT NULL,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE INDEX sessions_account ON sessions (account_id);
