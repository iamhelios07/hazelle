-- The account caps 0001 seeded are hazelle.app's; an installation that admits one account is someone's own, on their own
-- disk, so it has none. hazelle.app admits more and keeps its caps.
UPDATE service SET account_bytes_cap = NULL, account_file_bytes_cap = NULL WHERE signup_cap = 1;
