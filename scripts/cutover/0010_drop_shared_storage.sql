-- Moves into migrations/ at cutover step 5, after the release gates pass on the deployed app: deploy.sh applies every
-- file in migrations/ before it deploys, and until the new Worker is verified the old tables are what a fix forward
-- would still have. The server tests apply it after the migrations (src/server/testing.ts), so they run on the schema
-- it leaves.
DROP TABLE objects;
DROP TABLE files;
ALTER TABLE accounts DROP COLUMN rev;
ALTER TABLE accounts DROP COLUMN bytes;
ALTER TABLE accounts DROP COLUMN file_bytes;
