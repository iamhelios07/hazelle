-- 헤이젤 나우 (server/pulse.ts): a closed week's named rows under the floor, by name and place alone, never a count.
-- place: the week's order, most people first, ties by name then connection type. Weeks closed before this list none.
CREATE TABLE pulse_week_below (week INTEGER NOT NULL, role TEXT NOT NULL, key TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL, place INTEGER NOT NULL, PRIMARY KEY (week, role, key, type));
