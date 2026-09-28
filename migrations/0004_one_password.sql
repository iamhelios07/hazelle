-- One password now opens both the account and the vault (tech-spec §4). An older account cannot
-- sign in: the server kept an Argon2id hash of a password it no longer receives. The one such
-- account was deleted with its owner's consent on 2026-09-28. The delete cascades to its sessions,
-- vault and objects.
DELETE FROM accounts;

DROP TABLE vaults;

CREATE TABLE vaults (
  account_id TEXT PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  password_wrap TEXT NOT NULL,
  recovery_wrap TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
