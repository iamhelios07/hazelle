-- Run 2 of the 2026-10-03 cutover: the shared storage that the per-account stores (0009) replaced, dropped after the
-- owner's Risu move landed on the new Worker.
DROP TABLE objects;
DROP TABLE files;
ALTER TABLE accounts DROP COLUMN rev;
ALTER TABLE accounts DROP COLUMN bytes;
ALTER TABLE accounts DROP COLUMN file_bytes;
