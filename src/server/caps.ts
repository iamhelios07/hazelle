// The object bytes cap is read with the session and holds for that request's batch, in the account's store
// (session.ts); the picture cap is read by the upload's reservation, in the same statement (files.ts).
export const CAP = {
  bytes: 'CASE WHEN own_bytes_cap THEN bytes_cap ELSE (SELECT account_bytes_cap FROM service) END',
  fileBytes: 'CASE WHEN own_file_bytes_cap THEN file_bytes_cap ELSE (SELECT account_file_bytes_cap FROM service) END',
};
