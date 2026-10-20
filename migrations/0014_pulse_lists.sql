-- 헤이젤 나우 (server/pulse.ts) counts people from stored lists, so a restart loses no one; a past week is closed into
-- pulse_week* and its lists deleted. This week and the last 48 hours start again here: their counts cannot be split
-- back into people.
CREATE TABLE pulse_seen (week INTEGER NOT NULL, account TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE, PRIMARY KEY (week, account));
CREATE TABLE pulse_used (
  week INTEGER NOT NULL, role TEXT NOT NULL, key TEXT NOT NULL, type TEXT NOT NULL,
  account TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE, name TEXT,
  PRIMARY KEY (week, role, key, type, account)
);
CREATE TABLE pulse_replies (
  hour INTEGER NOT NULL, key TEXT NOT NULL, type TEXT NOT NULL,
  account TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE, name TEXT, replies INTEGER NOT NULL,
  PRIMARY KEY (hour, key, type, account)
);
DROP TABLE pulse_hour_replies;
DELETE FROM pulse_hours;
-- This week's Monday 00:00 KST, as weekOf in server/pulse.ts.
CREATE TEMP TABLE this_week AS SELECT now - (now - 313200000) % 604800000 AS week FROM (SELECT CAST(unixepoch('subsec') * 1000 AS INTEGER) AS now);
DELETE FROM pulse_week WHERE week >= (SELECT week FROM this_week);
DELETE FROM pulse_week_roles WHERE week >= (SELECT week FROM this_week);
DELETE FROM pulse_week_models WHERE week >= (SELECT week FROM this_week);
DROP TABLE this_week;
