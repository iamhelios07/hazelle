// A file's id is the SHA-256 of its sealed body (vault/files).
export const FILE_ID = /^[0-9a-f]{64}$/;
export const MAX_FILE_IDS = 1000;
// Counts sealed bytes, a few more than the file itself; the server's worker.ts enforces it, and a guest's browser store
// holds none larger, so everything a guest kept still uploads when an account is made.
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
// An import asks about a file before it writes the objects naming it (runtime/files), so a file asked about or
// uploaded within this long is never released.
export const CLAIM_SETTLE_MS = 60 * 60 * 1000;
// Of the ids asked, those the account holds no readable file for; the largest sealed body it takes; the bytes left
// under its picture cap, null for none.
export type MissingFiles = { missing: string[]; maxBytes: number; room: number | null };
// The files an account holds, a page at a time, on the timeline and revision its sweep weighs them against.
export type HeldFiles = { ids: string[]; more: boolean; timeline: string; rev: number };
// unused: held ids no object names, to release. named: ids objects name that the account does not hold.
export type FileSweep = { timeline: string; rev: number; unused: string[]; named: string[] };
export type SweptFiles = { released: number; taken: number };
