-- Reserved and stored picture bytes have one counter on their account incarnation. Reservation inserts and
-- increments share a transaction (server/files.ts). No live account deletes individual files. Deleting the account
-- removes this counter and cascades its reservations together.
ALTER TABLE accounts ADD COLUMN file_bytes INTEGER NOT NULL DEFAULT 0 CHECK (file_bytes >= 0);
UPDATE accounts SET file_bytes = (SELECT COALESCE(SUM(size), 0) FROM account_files WHERE incarnation = accounts.incarnation);
