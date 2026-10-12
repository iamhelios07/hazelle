-- A deleted account's pictures in a store that outlives the machine (HAZELLE_FILES_BUCKET=r2): a backup generation
-- names them there instead of copying them, so they go only at due_at, once no kept generation can name them
-- (src/server/reconcile.ts). No foreign key: the account's row is gone before its prefix is queued.
CREATE TABLE picture_removals (incarnation TEXT PRIMARY KEY, due_at INTEGER NOT NULL);
