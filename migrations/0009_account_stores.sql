-- Additive only: the Worker deployed before this migration keeps running on these tables until the next one replaces it.

-- incarnation: the one server-made id of an account's data, never changed and never reused. It names the account's
-- store, prefixes its pictures in R2 and keys its restore and picture rows, so a signup that reuses a client-made
-- account id meets nothing of the account that had it. state: active, restoring or leaving (src/server/lifecycle.ts).
-- timeline: replaced by every completed restore, and a device's cache must hold the current one. operation: the restore
-- that holds the account while it is restoring.
-- The defaults exist because ALTER TABLE cannot add a column with a random default: every insert names both values.
ALTER TABLE accounts ADD COLUMN incarnation TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN state TEXT NOT NULL DEFAULT 'active';
ALTER TABLE accounts ADD COLUMN timeline TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN operation INTEGER;

UPDATE accounts SET incarnation = lower(hex(randomblob(16))), timeline = lower(hex(randomblob(16)));

CREATE UNIQUE INDEX accounts_incarnation ON accounts (incarnation);

-- One restore of an account's store, run in phases (src/server/lifecycle.ts). Every phase change is a compare-and-set
-- on (id, phase).
-- at: the time asked for, null for an undo. undoes: the restore an undo rewinds, null for a restore.
-- timeline: installed when it completes. checkpoint: the store's bookmark taken while fenced, the exact undo, written
-- once. target: the bookmark the store rewinds to. returned: what arming the rewind answered, a second record only.
-- error: a short code, never prose. verified: the store was seen loading the operation's end state.
-- id is never used again (AUTOINCREMENT): rows go with their account, and a request still holding a deleted
-- operation's id must not name another account's.
CREATE TABLE restores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incarnation TEXT NOT NULL REFERENCES accounts (incarnation) ON DELETE CASCADE,
  report_id INTEGER NOT NULL,
  at INTEGER,
  undoes INTEGER,
  timeline TEXT NOT NULL,
  checkpoint TEXT,
  checkpoint_at INTEGER,
  target TEXT,
  returned TEXT,
  phase TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX restores_incarnation ON restores (incarnation, id);

-- An account's pictures, each under files/<incarnation>/<id> in R2 (src/server/files.ts). The account's picture bytes
-- are the sum of its rows. stored: the bytes are in R2.
CREATE TABLE account_files (
  incarnation TEXT NOT NULL REFERENCES accounts (incarnation) ON DELETE CASCADE,
  id TEXT NOT NULL,
  size INTEGER NOT NULL,
  stored INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (incarnation, id)
);

-- A block refuses a picture by its content id to every account.
CREATE TABLE file_blocks (
  id TEXT PRIMARY KEY,
  blocked_at INTEGER NOT NULL
);

INSERT INTO file_blocks SELECT id, blocked_at FROM files WHERE blocked_at IS NOT NULL;

-- 300 MB for every account at launch. The app counts 1 MB as 1,000,000 bytes.
UPDATE service SET account_bytes_cap = 300000000, account_file_bytes_cap = 3000000000;
