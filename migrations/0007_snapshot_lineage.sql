-- timeline: the account's timeline when the snapshot was taken, the lineage a delta may descend from
-- (src/server/db/account-db.ts CURRENT_BASE). schema_version: the account schema the file holds. Rows from before this
-- migration have neither and are never a base.
ALTER TABLE snapshots ADD COLUMN timeline TEXT;
ALTER TABLE snapshots ADD COLUMN schema_version INTEGER;
