ALTER TABLE service ADD COLUMN pulse_guests INTEGER NOT NULL DEFAULT 1 CHECK (pulse_guests IN (0, 1));
CREATE TABLE pulse_guest_seen (week INTEGER NOT NULL, account TEXT NOT NULL, PRIMARY KEY (week, account));
CREATE TABLE pulse_guest_used (
  week INTEGER NOT NULL, role TEXT NOT NULL, key TEXT NOT NULL, type TEXT NOT NULL,
  account TEXT NOT NULL, name TEXT, PRIMARY KEY (week, role, key, type, account)
);
CREATE TABLE pulse_guest_replies (
  hour INTEGER NOT NULL, key TEXT NOT NULL, type TEXT NOT NULL, account TEXT NOT NULL,
  name TEXT, replies INTEGER NOT NULL, PRIMARY KEY (hour, key, type, account)
);
CREATE VIEW pulse_people_seen AS
  SELECT week, account FROM pulse_seen
  UNION SELECT week, account FROM pulse_guest_seen;
CREATE VIEW pulse_rank_used AS
  SELECT week, role, key, type, account, name FROM pulse_used
  UNION ALL SELECT week, role, key, type, account, name FROM pulse_guest_used
  WHERE (SELECT pulse_guests FROM service) = 1;
CREATE VIEW pulse_rank_replies AS
  SELECT hour, key, type, account, name, replies FROM pulse_replies
  UNION ALL SELECT hour, key, type, account, name, replies FROM pulse_guest_replies
  WHERE (SELECT pulse_guests FROM service) = 1;
