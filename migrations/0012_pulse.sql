-- 헤이젤 지금 (server/pulse.ts): aggregates only, never an account. Weeks start Monday 00:00 KST, hours on the hour (ms).
-- Labels count from starts on: one day after this migration ran, so after the deploy that ships the notice.
CREATE TABLE pulse_start (id INTEGER PRIMARY KEY CHECK (id = 1), starts INTEGER NOT NULL);
INSERT INTO pulse_start VALUES (1, CAST(unixepoch('subsec') * 1000 AS INTEGER) + 86400000);
CREATE TABLE pulse_week (week INTEGER PRIMARY KEY, people INTEGER NOT NULL);
CREATE TABLE pulse_week_roles (week INTEGER NOT NULL, role TEXT NOT NULL, people INTEGER NOT NULL, PRIMARY KEY (week, role));
-- key: the model's merge key, '' for 기타 (name NULL). type: the connection type, '' for the row merged across types.
CREATE TABLE pulse_week_models (week INTEGER NOT NULL, role TEXT NOT NULL, key TEXT NOT NULL, type TEXT NOT NULL, name TEXT, people INTEGER NOT NULL, PRIMARY KEY (week, role, key, type));
CREATE TABLE pulse_hours (hour INTEGER NOT NULL, role TEXT NOT NULL, calls INTEGER NOT NULL, PRIMARY KEY (hour, role));
-- 대화 replies per model, keyed as pulse_week_models.
CREATE TABLE pulse_hour_replies (hour INTEGER NOT NULL, key TEXT NOT NULL, type TEXT NOT NULL, name TEXT, replies INTEGER NOT NULL, PRIMARY KEY (hour, key, type));
-- The stored list has no display names: the next refresh fetches it again, under a new ETag.
ALTER TABLE models_dev ADD COLUMN name TEXT;
UPDATE models_dev_fetch SET fetched_at = NULL, tried_at = NULL;
