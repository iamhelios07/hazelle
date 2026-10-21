CREATE TABLE visit_days (
  day INTEGER PRIMARY KEY,
  visitors INTEGER NOT NULL DEFAULT 0,
  guests INTEGER NOT NULL DEFAULT 0,
  accounts INTEGER NOT NULL DEFAULT 0,
  converted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE visit_keys (day INTEGER PRIMARY KEY, key BLOB NOT NULL);
CREATE TABLE visit_hashes (
  day INTEGER NOT NULL REFERENCES visit_keys(day) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  PRIMARY KEY (day, hash)
);

-- Only history still stored at installation can be reconstructed.
INSERT INTO visit_days (day, accounts, converted)
SELECT (a.created_at + 32400000) / 86400000 * 86400000 - 32400000 AS day, COUNT(*),
  SUM(EXISTS (SELECT 1 FROM pulse_guest_seen WHERE account = a.id
    UNION ALL SELECT 1 FROM pulse_guest_used WHERE account = a.id
    UNION ALL SELECT 1 FROM pulse_guest_replies WHERE account = a.id))
FROM accounts a GROUP BY day;
INSERT INTO visit_days (day, guests)
SELECT (hour + 32400000) / 86400000 * 86400000 - 32400000 AS day, COUNT(DISTINCT account)
FROM pulse_guest_replies GROUP BY day
ON CONFLICT (day) DO UPDATE SET guests = excluded.guests;

-- KST midnight, in milliseconds. Guest reply lists already deduplicate people across models and providers.
CREATE TRIGGER visit_guest_reply AFTER INSERT ON pulse_guest_replies BEGIN
  INSERT INTO visit_days (day, guests)
  SELECT (NEW.hour + 32400000) / 86400000 * 86400000 - 32400000, COUNT(DISTINCT account)
  FROM pulse_guest_replies
  WHERE hour >= (NEW.hour + 32400000) / 86400000 * 86400000 - 32400000
    AND hour < (NEW.hour + 32400000) / 86400000 * 86400000 + 54000000
  ON CONFLICT (day) DO UPDATE SET guests = excluded.guests;
END;

-- Count inside signup's transaction, before weekly guest lists can disappear or an account can leave.
CREATE TRIGGER visit_signup AFTER INSERT ON accounts BEGIN
  INSERT INTO visit_days (day, accounts, converted)
  VALUES (
    (NEW.created_at + 32400000) / 86400000 * 86400000 - 32400000, 1,
    EXISTS (SELECT 1 FROM pulse_guest_seen WHERE account = NEW.id
      UNION ALL SELECT 1 FROM pulse_guest_used WHERE account = NEW.id
      UNION ALL SELECT 1 FROM pulse_guest_replies WHERE account = NEW.id)
  )
  ON CONFLICT (day) DO UPDATE SET accounts = accounts + 1, converted = converted + excluded.converted;
END;
