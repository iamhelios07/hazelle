CREATE TABLE vaults (
  account_id TEXT PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  kdf TEXT NOT NULL,
  passphrase_wrap TEXT NOT NULL,
  recovery_wrap TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
