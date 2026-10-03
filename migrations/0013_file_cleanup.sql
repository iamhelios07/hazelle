-- The bounded R2 cleanup queue is durable before any prefix is deleted. The lexical marker does not depend on
-- keys surviving a deletion (server/files.ts). Incarnations are never reused, so queued dead prefixes stay dead.
CREATE TABLE file_cleanup (prefix TEXT PRIMARY KEY);
CREATE TABLE file_sweep (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), after_key TEXT NOT NULL);
INSERT INTO file_sweep VALUES (1, '');
