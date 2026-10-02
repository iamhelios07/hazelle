-- The bytes of the files the account was first to store, kept by the upload (src/server/files.ts). A file stays when
-- the objects naming it go, so nothing lowers it.
ALTER TABLE accounts ADD COLUMN file_bytes INTEGER NOT NULL DEFAULT 0;

-- No uploader was kept before, so each account is charged the files its objects name: a file two accounts name, both.
UPDATE accounts SET file_bytes = (SELECT COALESCE(SUM(size), 0) FROM files WHERE id IN (SELECT file_id FROM objects WHERE account_id = accounts.id));

-- A null cap is no cap.
ALTER TABLE service ADD COLUMN account_file_bytes_cap INTEGER;

-- An account's own caps, which replace the service's for it (src/server/caps.ts). own_* is 1 when it has one, and its
-- cap is then the value beside it, where null is no cap.
ALTER TABLE accounts ADD COLUMN own_bytes_cap INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN bytes_cap INTEGER;
ALTER TABLE accounts ADD COLUMN own_file_bytes_cap INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN file_bytes_cap INTEGER;
