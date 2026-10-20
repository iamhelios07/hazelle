// The object feed and batch as the server's store (server/account-store) and a guest's browser store
// (runtime/guest-store) both answer them, and the client's store (runtime/store) reads them.

// bytes: the whole batch request, timeline included. The sizes date from the Cloudflare store (a 2 MB row, a 32 MiB RPC).
export const BATCH_LIMITS = { items: 200, bytes: 4_000_000, body: 1_500_000 };
export type BatchLimits = typeof BATCH_LIMITS;

// once: a create of a row written once and never changed (the client's ledger), which may be sent again after its
// answer was lost. One already there under its kind and parent is that create landed, and answers with its rev.
export type SealedWrite = { id: string; kind: string; parent: string | null; body: string | null; baseRev: number | null; once?: true };
// body null: a deletion. omitted: a live row the query asked without its body.
export type SealedChange = { id: string; kind: string; parent: string | null; rev: number; body?: string | null; omitted?: true };
// count: the first page of a bootstrap asks how many changes the whole bootstrap holds, for a bar.
export type FeedQuery = { timeline: string | null; since: number; known: number; until: number | null; bootstrap: boolean; metadata: boolean; excluded: string[]; parent: string | null; kind: string | null; count: boolean };
export type FeedAnswer = { limits: BatchLimits; timeline: string; until?: number; changes: SealedChange[]; cursor: number; more: boolean; total?: number };
export type BatchAnswer = { revs: number[]; timeline: string };
