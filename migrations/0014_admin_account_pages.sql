-- Keyset pagination for account rows and the explicit usage traversal (server/admin.ts).
CREATE INDEX accounts_created ON accounts (created_at, id);
