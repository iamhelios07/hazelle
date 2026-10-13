-- base: NULL for a snapshot that is a whole account file; for a delta, the id of the whole snapshot it applies on
-- (src/server/db/account-db.ts materializeSnapshot). A whole snapshot stays while any row names it.
ALTER TABLE snapshots ADD COLUMN base TEXT;
