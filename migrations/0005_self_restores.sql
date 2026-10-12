-- An account rewinds itself from 설정 › 계정: its restores have no report (report_id NULL). The operator's still name
-- the report they answer. SQLite cannot drop NOT NULL in place, so the table is rebuilt; nothing references it.
CREATE TABLE restores_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incarnation TEXT NOT NULL REFERENCES accounts (incarnation) ON DELETE CASCADE,
  report_id INTEGER,
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
  updated_at INTEGER NOT NULL,
  ended_at INTEGER
);
INSERT INTO restores_new SELECT id, incarnation, report_id, at, undoes, timeline, checkpoint, checkpoint_at, target, returned, phase, verified, error, created_at, updated_at, ended_at FROM restores;
-- An id is never used again (0001): the new table carries on the old sequence, not the highest id still present.
DELETE FROM sqlite_sequence WHERE name = 'restores_new';
INSERT INTO sqlite_sequence (name, seq) SELECT 'restores_new', seq FROM sqlite_sequence WHERE name = 'restores';
DROP TABLE restores;
ALTER TABLE restores_new RENAME TO restores;
CREATE INDEX restores_incarnation ON restores (incarnation, id);
