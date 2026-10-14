-- R2 generations name archives in the store, so an expired catalog row cannot remove its object until every
-- generation that could name it has expired. No foreign key: the catalog row and account may already be gone.
CREATE TABLE snapshot_removals (key TEXT PRIMARY KEY, due_at INTEGER NOT NULL);
