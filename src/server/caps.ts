// The cap that applies to an account, as SQL over its accounts row: its own when the operator gave it one, else the
// service's. The object bytes cap is read with the session and holds for that request's batch, in the account's store
// (session.ts); the picture cap is read by the upload's reservation, in the same statement (files.ts).
export const CAP = {
  bytes: 'CASE WHEN own_bytes_cap THEN bytes_cap ELSE (SELECT account_bytes_cap FROM service) END',
  fileBytes: 'CASE WHEN own_file_bytes_cap THEN file_bytes_cap ELSE (SELECT account_file_bytes_cap FROM service) END',
};

// An answer that changed or read an account's counts carries them, so the page holding the account stays current.
// The client reads the same names (runtime/api).
export const USE_HEADERS = { bytes: 'x-account-bytes', fileBytes: 'x-account-file-bytes' } as const;
