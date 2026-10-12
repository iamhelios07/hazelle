-- Share links (src/server/shares.ts): sealed content an account publishes under one link, opened by anyone holding the
-- link and its key. Nothing here names what is shared: characters publish through it now, tools later (design §6.10).

-- id: the link's id, made by the server. incarnation: the sharer's data; the shares go with the account. cover: the
-- sharer's opt-in text for the link's embed, JSON {name, creator, line}, NULL for none. received: how many times a
-- visitor finished taking it. held_at: paused, by the first report (held_report) or by the operator directly (NULL
-- report). reviewed_at: the operator lifted a hold or blocked it; a reviewed share is never held by a report again,
-- so reports cannot pause a link over and over. cut_at: the sharer cut the link. removed_at: the operator blocked it.
CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  incarnation TEXT NOT NULL REFERENCES accounts (incarnation) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  cover TEXT,
  received INTEGER NOT NULL DEFAULT 0,
  held_at INTEGER,
  held_report INTEGER,
  reviewed_at INTEGER,
  cut_at INTEGER,
  removed_at INTEGER
);
CREATE INDEX shares_incarnation ON shares (incarnation, created_at);

-- A published version never changes. manifest: the sealed manifest's file id, stored among the sharer's files.
CREATE TABLE share_versions (
  share TEXT NOT NULL REFERENCES shares (id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  manifest TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (share, version)
);

-- The plain list of the files a version names, so a block reaches them by content id (file_blocks).
CREATE TABLE share_files (
  share TEXT NOT NULL,
  version INTEGER NOT NULL,
  file TEXT NOT NULL,
  PRIMARY KEY (share, version, file),
  FOREIGN KEY (share, version) REFERENCES share_versions (share, version) ON DELETE CASCADE
);
CREATE INDEX share_files_file ON share_files (share, file);

-- One inbox: a report is an account's message to the operator, or a report on a share, sent by anyone holding its
-- link. account_id and username: the sender, NULL for a share report sent signed out. share, share_version: the share
-- and the version its page showed. link: the full link with its key, which is how the operator opens a reported share.
-- SQLite drops NOT NULL only by rebuilding the table; ids are kept, since notices and restores name them.
CREATE TABLE reports_shared (
  id INTEGER PRIMARY KEY,
  account_id TEXT,
  username TEXT,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  share TEXT,
  share_version INTEGER,
  link TEXT,
  CHECK (share IS NOT NULL OR (account_id IS NOT NULL AND username IS NOT NULL))
);
INSERT INTO reports_shared (id, account_id, username, text, created_at, resolved_at) SELECT id, account_id, username, text, created_at, resolved_at FROM reports;
DROP TABLE reports;
ALTER TABLE reports_shared RENAME TO reports;
CREATE INDEX reports_open ON reports (account_id) WHERE resolved_at IS NULL;
CREATE INDEX reports_share_open ON reports (share) WHERE resolved_at IS NULL AND share IS NOT NULL;

-- The share consent the account agreed to (SHARE_CONSENT in src/contracts/shares.ts) and when; NULL for none.
ALTER TABLE accounts ADD COLUMN share_consent INTEGER;
ALTER TABLE accounts ADD COLUMN share_consent_at INTEGER;
