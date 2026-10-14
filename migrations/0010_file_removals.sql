-- A picture no object of its account names any more, released by the account's sweep (src/server/files.ts release):
-- its account_files row moves here, so it no longer counts against the cap, serves, or is named by a later backup
-- generation. Its bytes go at due_at, once no generation from before the release is kept, and only once no snapshot a
-- rewind can land on predates the release (src/server/reconcile.ts); a rewind brings back each one released since its
-- target was taken (src/server/lifecycle.ts), and an upload of it takes it back (files.ts). removing: its bytes are
-- being deleted, and an upload of it waits. A pair is in account_files or here, never both.
CREATE TABLE file_removals (
  incarnation TEXT NOT NULL REFERENCES accounts (incarnation) ON DELETE CASCADE,
  id TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  released_at INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  removing INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (incarnation, id)
);
CREATE INDEX file_removals_due ON file_removals (due_at);

-- claimed_at: when an import last asked about or uploaded the file, which a release must be well past, since the
-- objects naming it are written after the ask (runtime/files).
ALTER TABLE account_files ADD COLUMN claimed_at INTEGER NOT NULL DEFAULT 0;
UPDATE account_files SET claimed_at = created_at;
