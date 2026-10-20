-- Migration 0015 deleted the reply notices, often the newest ones. notices has no AUTOINCREMENT, so the next notice takes
-- the highest id left plus one, which an account that had read a deleted reply has already passed: it would count as
-- seen. Every notice left at or under the pointer was seen, so the pointer comes down to the highest id left.
UPDATE accounts SET notices_seen = MIN(notices_seen, (SELECT COALESCE(MAX(id), 0) FROM notices));
