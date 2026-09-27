ALTER TABLE accounts ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;

CREATE TABLE objects (
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  parent_id TEXT,
  rev INTEGER NOT NULL,
  body TEXT,
  deleted_at INTEGER,
  PRIMARY KEY (account_id, id)
);

CREATE INDEX objects_rev ON objects (account_id, rev);
