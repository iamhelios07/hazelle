-- Files every account shares, by the SHA-256 of their sealed body (tech-spec §5).
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- The file a live object names, which the server sees so an unnamed file can be found once files are removed.
ALTER TABLE objects ADD COLUMN file_id TEXT;

CREATE INDEX objects_file ON objects (file_id) WHERE file_id IS NOT NULL;
