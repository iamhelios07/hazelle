-- 게시판 (src/server/board.ts, design §6.13). Plaintext by nature: the board is public.

-- name_key: contracts/board nicknameKey(name), unique across accounts.
CREATE TABLE board_names (
  account_id TEXT PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  changed_at INTEGER NOT NULL
);

-- account_id: the author, NULL once the account left (탈퇴한 사용자). text NULL with deleted: the author deleted a post
-- that had comments, and the row stays as a placeholder over them. status_at: the operator's last status change, the
-- time of its activity row. hidden_reason set: the operator hid it, until hidden_until (a hold) or, NULL, until shown
-- again; a passed hidden_until is read as shown. Ids are never used again (AUTOINCREMENT): reports and restores name
-- posts that may since be removed.
CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT REFERENCES accounts (id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  text TEXT,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  status_at INTEGER,
  version TEXT,
  visibility TEXT NOT NULL,
  diagnostics TEXT,
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  locked INTEGER NOT NULL DEFAULT 0,
  hidden_reason TEXT,
  hidden_until INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX posts_visibility ON posts (visibility, id);
CREATE INDEX posts_account ON posts (account_id, created_at);

CREATE TABLE post_votes (
  post_id INTEGER NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, account_id)
);
CREATE INDEX post_votes_account ON post_votes (account_id);

-- parent_id: the top-level comment a 답글 sits under; never a 답글 itself. text NULL with deleted: a placeholder over
-- its 답글. Hidden as posts are.
CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES comments (id) ON DELETE CASCADE,
  account_id TEXT REFERENCES accounts (id) ON DELETE SET NULL,
  text TEXT,
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  hidden_reason TEXT,
  hidden_until INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX comments_post ON comments (post_id, id);
CREATE INDEX comments_parent ON comments (parent_id);
CREATE INDEX comments_account ON comments (account_id, created_at);

-- The time of the newest board activity the account saw (src/server/unread.ts).
ALTER TABLE accounts ADD COLUMN board_seen INTEGER NOT NULL DEFAULT 0;

-- A report is on a share, a post or a comment (comment_id with its post_id).
ALTER TABLE reports ADD COLUMN post_id INTEGER;
ALTER TABLE reports ADD COLUMN comment_id INTEGER;

-- An account's messages to the operator become its operator-only posts under the same ids, which restores.report_id
-- names. The author is kept only while the account that sent it holds the id.
INSERT INTO posts (id, account_id, title, text, category, status, status_at, visibility, diagnostics, created_at)
SELECT r.id, (SELECT a.id FROM accounts a WHERE a.id = r.account_id AND a.created_at <= r.created_at),
  substr(rtrim(CASE WHEN instr(r.text, char(10)) > 0 THEN substr(r.text, 1, instr(r.text, char(10)) - 1) ELSE r.text END, char(13) || ' '), 1, 80),
  r.text, 'question', CASE WHEN r.resolved_at IS NULL THEN 'open' ELSE 'seen' END, r.resolved_at, 'operator', r.diagnostics, r.created_at
FROM reports r WHERE r.share IS NULL;

-- The operator's replies become the operator's comments on those posts. A reply whose report was already forgotten
-- stays a plain notice.
INSERT INTO comments (post_id, account_id, text, created_at)
SELECT n.report_id, (SELECT operator_account FROM installation), n.text, n.created_at FROM notices n WHERE n.report_id IN (SELECT id FROM posts) ORDER BY n.id;

-- What the account has already seen counts as seen: everything up to now, or, with a reply it had not read, everything
-- before the oldest such reply.
UPDATE accounts SET board_seen = COALESCE(
  (SELECT MIN(n.created_at) - 1 FROM notices n WHERE n.incarnation = accounts.incarnation AND n.report_id IN (SELECT id FROM posts) AND n.id > accounts.notices_seen),
  CAST(unixepoch('subsec') * 1000 AS INTEGER));

DELETE FROM notices WHERE report_id IN (SELECT id FROM posts);
-- SQLite drops a column only by rebuilding the table; ids are kept, since accounts.notices_seen compares them.
CREATE TABLE notices_new (
  id INTEGER PRIMARY KEY,
  incarnation TEXT REFERENCES accounts (incarnation) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT INTO notices_new (id, incarnation, text, created_at) SELECT id, incarnation, text, created_at FROM notices;
DROP TABLE notices;
ALTER TABLE notices_new RENAME TO notices;
CREATE INDEX notices_incarnation ON notices (incarnation, id);

DELETE FROM reports WHERE share IS NULL;
