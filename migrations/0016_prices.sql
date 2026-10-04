-- models.dev's prices (server/prices.ts), one row per price list and model id, in USD per million tokens. tiers is
-- PriceTier[] as JSON (connectors/price-list.ts).
CREATE TABLE prices (list TEXT NOT NULL, model TEXT NOT NULL, input REAL NOT NULL, output REAL NOT NULL, cache_read REAL, cache_write REAL, tiers TEXT NOT NULL, PRIMARY KEY (list, model));
-- Its one row. fetched_at: when the stored prices were fetched, null before the first fetch. tried_at: when the last
-- fetch began, which keeps another from beginning meanwhile.
CREATE TABLE price_fetch (id INTEGER PRIMARY KEY CHECK (id = 1), fetched_at INTEGER, tried_at INTEGER);
INSERT INTO price_fetch (id) VALUES (1);
