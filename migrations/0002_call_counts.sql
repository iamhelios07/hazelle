-- Provider calls per account, per UTC day and kind, as the privacy page names them (src/server/call-counts.ts).
-- day: the UTC midnight, in milliseconds. kind: generate, bot, short or refused (src/contracts/admin.ts CallKind).
-- Counting began when this file applied (its row in migrations): a day before that is not recorded, not zero.
CREATE TABLE call_counts (
  incarnation TEXT NOT NULL REFERENCES accounts (incarnation) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  kind TEXT NOT NULL,
  calls INTEGER NOT NULL,
  PRIMARY KEY (incarnation, day, kind)
);
