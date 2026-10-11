-- The models.dev list keeps what each model takes and gives beside its price, and keeps a model it cannot price.
-- price, input, output: JSON, NULL where models.dev does not say.
DROP TABLE prices;
CREATE TABLE models_dev (list TEXT NOT NULL, model TEXT NOT NULL, price TEXT, input TEXT, output TEXT, PRIMARY KEY (list, model));
ALTER TABLE price_fetch RENAME TO models_dev_fetch;
-- The stored list has no inputs or outputs: the first ask after the upgrade fetches it again, under a new ETag.
UPDATE models_dev_fetch SET fetched_at = NULL, tried_at = NULL;
