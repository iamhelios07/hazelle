-- The service schema as the Cloudflare build left it (migrations 0001–0016 of that build, replayed and compared by
-- docs/research/probes/docker-port-2026-10-05/baseline-compare.mjs), minus live_calls, file_cleanup and file_sweep,
-- plus installation and snapshots. Every later change is a new file; this one never changes.

-- incarnation: the server-made id of an account's data, never changed and never reused. It names the account's file,
-- its pictures and its restore rows, so a signup that reuses a client-made account id meets nothing of the account
-- that had it. state: active, restoring or leaving (src/server/lifecycle.ts). timeline: replaced by every completed
-- restore; a device's cache must hold the current one. operation: the restore holding the account while it restores.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  login_hash TEXT NOT NULL,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at INTEGER NOT NULL,
  suspended_at INTEGER,
  own_bytes_cap INTEGER NOT NULL DEFAULT 0,
  bytes_cap INTEGER,
  own_file_bytes_cap INTEGER NOT NULL DEFAULT 0,
  file_bytes_cap INTEGER,
  incarnation TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  timeline TEXT NOT NULL,
  operation INTEGER,
  notices_seen INTEGER NOT NULL DEFAULT 0,
  file_bytes INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX accounts_incarnation ON accounts (incarnation);
CREATE INDEX accounts_created ON accounts (created_at, id);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_account ON sessions (account_id);

CREATE TABLE vaults (
  account_id TEXT PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  password_wrap TEXT NOT NULL,
  recovery_wrap TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- The operator's caps for every account; an account's own row overrides them (src/server/caps.ts). 300 MB of objects
-- and 3 GB of pictures per account at launch; the app counts 1 MB as 1,000,000 bytes.
CREATE TABLE service (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  signup_cap INTEGER NOT NULL,
  account_bytes_cap INTEGER,
  account_file_bytes_cap INTEGER
);
INSERT INTO service (id, signup_cap, account_bytes_cap, account_file_bytes_cap) VALUES (1, 1, 300000000, 3000000000);

-- The first signup on a fresh installation becomes the operator; account deletion never resets the row, and the only
-- operator cannot delete their own account (src/server/accounts.ts, lifecycle.ts).
CREATE TABLE installation (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  operator_account TEXT,
  created_at INTEGER NOT NULL
);
INSERT INTO installation (id, operator_account, created_at) VALUES (1, NULL, unixepoch() * 1000);

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

-- One restore of an account's file, run in phases (src/server/lifecycle.ts). Every phase change is a compare-and-set
-- on (id, phase). at: the time asked for, null for an undo. undoes: the restore an undo rewinds. timeline: installed
-- when it completes. checkpoint: the snapshot taken while fenced, the exact undo, written once. target: the snapshot
-- the account rewinds to. returned: what arming answered, a record only. error: a short code, never prose. verified:
-- the account's file was seen loading the operation's end state. id is never used again (AUTOINCREMENT): rows go with
-- their account, and a request still holding a deleted operation's id must not name another account's.
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

-- An account's pictures, each at files/<incarnation>/<id> (src/server/files.ts). The account's picture bytes are the
-- sum of its rows. stored: the bytes are on disk.
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

CREATE TABLE notices (
  id INTEGER PRIMARY KEY,
  incarnation TEXT REFERENCES accounts (incarnation) ON DELETE CASCADE,
  report_id INTEGER,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX notices_incarnation ON notices (incarnation, id);

CREATE TABLE prices (list TEXT NOT NULL, model TEXT NOT NULL, input REAL NOT NULL, output REAL NOT NULL, cache_read REAL, cache_write REAL, tiers TEXT NOT NULL, PRIMARY KEY (list, model));
CREATE TABLE price_fetch (id INTEGER PRIMARY KEY CHECK (id = 1), fetched_at INTEGER, tried_at INTEGER);
INSERT INTO price_fetch (id) VALUES (1);

-- The catalog of an account's snapshot files, snapshots/<incarnation>/<id>.sqlite.gz: a row exists only once its file
-- is durable (src/server/db/account-db.ts). kind: baseline (the daily copy) or checkpoint (an operation's exact undo,
-- operation set). No cascade: a deleted account's snapshots age out on their own (design.md, retention).
CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  incarnation TEXT NOT NULL,
  kind TEXT NOT NULL,
  operation INTEGER,
  taken_at INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL
);
CREATE INDEX snapshots_incarnation ON snapshots (incarnation, taken_at);
