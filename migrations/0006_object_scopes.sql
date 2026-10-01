CREATE INDEX objects_parent_rev ON objects (account_id, parent_id, rev);

-- The global cursor stays in revision order, including omitted bodies.
DROP INDEX objects_rev;
CREATE INDEX objects_rev ON objects (account_id, rev, kind, parent_id, id, deleted_at);
