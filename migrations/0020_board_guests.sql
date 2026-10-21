ALTER TABLE service ADD COLUMN board_guests INTEGER NOT NULL DEFAULT 1 CHECK (board_guests IN (0, 1));
-- Unlike the relay's daily in-memory key, this key must survive restarts so address blocks keep matching.
ALTER TABLE service ADD COLUMN board_guest_key TEXT NOT NULL DEFAULT '';
UPDATE service SET board_guest_key = lower(hex(randomblob(32)));

ALTER TABLE posts ADD COLUMN guest_secret_hash TEXT;
ALTER TABLE posts ADD COLUMN guest_address_hash TEXT;
ALTER TABLE comments ADD COLUMN guest_secret_hash TEXT;
ALTER TABLE comments ADD COLUMN guest_address_hash TEXT;
CREATE INDEX posts_guest_secret ON posts (guest_secret_hash, created_at);
CREATE INDEX comments_guest_secret ON comments (guest_secret_hash, created_at);
CREATE INDEX posts_guest_address ON posts (guest_address_hash, created_at);
CREATE INDEX comments_guest_address ON comments (guest_address_hash, created_at);
CREATE TABLE board_guest_blocks (secret_hash TEXT PRIMARY KEY);
CREATE TABLE board_guest_address_blocks (address_hash TEXT PRIMARY KEY, until INTEGER NOT NULL);
