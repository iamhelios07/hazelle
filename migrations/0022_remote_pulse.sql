-- A self-hosted installation's forwarded pings (pulse.ts /remote) land in the guest lists under a 'remote:' person; the
-- operator's daily 손님 응답 counts this server's own guests only.
DROP TRIGGER visit_guest_reply;
CREATE TRIGGER visit_guest_reply AFTER INSERT ON pulse_guest_replies WHEN NEW.account NOT LIKE 'remote:%' BEGIN
  INSERT INTO visit_days (day, guests)
  SELECT (NEW.hour + 32400000) / 86400000 * 86400000 - 32400000, COUNT(DISTINCT account)
  FROM pulse_guest_replies
  WHERE hour >= (NEW.hour + 32400000) / 86400000 * 86400000 - 32400000
    AND hour < (NEW.hour + 32400000) / 86400000 * 86400000 + 54000000
    AND account NOT LIKE 'remote:%'
  ON CONFLICT (day) DO UPDATE SET guests = excluded.guests;
END;
