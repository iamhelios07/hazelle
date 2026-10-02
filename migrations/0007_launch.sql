-- The one row of values the operator changes without a deploy. A null byte cap is no cap.
CREATE TABLE service (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  signup_cap INTEGER NOT NULL,
  account_bytes_cap INTEGER
);

-- Signup had closed after the first account, and a cap of one keeps it closed until the operator raises it.
INSERT INTO service (id, signup_cap, account_bytes_cap) VALUES (1, 1, NULL);

ALTER TABLE accounts ADD COLUMN suspended_at INTEGER;

-- The bytes of the account's object bodies, kept by the write batch (src/server/objects.ts).
ALTER TABLE accounts ADD COLUMN bytes INTEGER NOT NULL DEFAULT 0;

UPDATE accounts SET bytes = (SELECT COALESCE(SUM(LENGTH(CAST(body AS BLOB))), 0) FROM objects WHERE account_id = accounts.id);

-- No foreign key: a report stays when its sender's account goes, with the username as it was.
CREATE TABLE reports (
  id INTEGER PRIMARY KEY,
  account_id TEXT NOT NULL,
  username TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE INDEX reports_open ON reports (account_id) WHERE resolved_at IS NULL;

CREATE TABLE admin_log (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  detail TEXT
);

ALTER TABLE files ADD COLUMN blocked_at INTEGER;
