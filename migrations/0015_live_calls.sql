-- One row per call a ReplyStream is making (server/streams.ts), counted by scripts/deploy.sh. started_at is ms since
-- the epoch on both sides (Date.now(), date +%s%3N).
CREATE TABLE live_calls (account TEXT NOT NULL, call TEXT NOT NULL, started_at INTEGER NOT NULL, PRIMARY KEY (account, call));
