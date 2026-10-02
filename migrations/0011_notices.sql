-- 0010 is the cutover's scripts/cutover/0010_drop_shared_storage.sql, which moves into migrations/ at its step.

-- What the operator sent, in plaintext: the operator wrote it. incarnation: the one account it is to, null for every
-- account created at or before it was sent. It goes with the account. report_id: the report it answers.
CREATE TABLE notices (
  id INTEGER PRIMARY KEY,
  incarnation TEXT REFERENCES accounts (incarnation) ON DELETE CASCADE,
  report_id INTEGER,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX notices_incarnation ON notices (incarnation, id);

-- The id of the newest notice the person has seen.
ALTER TABLE accounts ADD COLUMN notices_seen INTEGER NOT NULL DEFAULT 0;
