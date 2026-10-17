// The object bytes cap is read with the session and holds for that request's batch, in the account's store
// (session.ts); the picture cap is read by the upload's reservation, in the same statement (files.ts).
export const CAP = {
  bytes: 'CASE WHEN own_bytes_cap THEN bytes_cap ELSE (SELECT account_bytes_cap FROM service) END',
  fileBytes: 'CASE WHEN own_file_bytes_cap THEN file_bytes_cap ELSE (SELECT account_file_bytes_cap FROM service) END',
};

// What the object cap counts besides the bodies: the rows they leave on disk. Every object row, a deletion included,
// stays for sync and incremental snapshots (measured 220-320 bytes each). A link's own row with its cover, and each
// row naming a file of a version (its manifest or a picture), live in the service database (measured ~780 for a link
// with its first version, ~300 a file row).
export const ROW_BYTES = { object: 256, share: 512, shareFile: 300 };

// The service-database bytes an account's links hold, over ?1, its incarnation.
export const SHARED_BYTES = `SELECT ${ROW_BYTES.share} * COUNT(*)
  + ${ROW_BYTES.shareFile} * (SELECT COUNT(*) FROM share_versions WHERE share IN (SELECT id FROM shares WHERE incarnation = ?1))
  + ${ROW_BYTES.shareFile} * (SELECT COUNT(*) FROM share_files WHERE share IN (SELECT id FROM shares WHERE incarnation = ?1))
  AS bytes FROM shares WHERE incarnation = ?1`;
