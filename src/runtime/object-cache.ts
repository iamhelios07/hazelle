export type SealedChange = { id: string; kind: string; parent: string | null; rev: number; body?: string | null; omitted?: true };
export type CacheState = {
  cursor: number;
  complete: boolean;
  until: number | null;
  limits: { items: number; bytes: number; body: number } | null;
  heads: [string, number][];
  revisions: [string, number][];
};
export type CachedScope = { state: CacheState; changes: SealedChange[] };
export type CacheWrite = { changes: SealedChange[]; feed: CacheState; scopes?: { chat: string; state: CacheState }[] };

// Each write commits the rows and their cursors atomically. Bodies are server ciphertext, never opened values.
export interface DeviceCache {
  read(chat?: string): Promise<CachedScope | null>;
  write(write: CacheWrite): Promise<void>;
  clear(): Promise<void>;
}

export const SCOPED = new Set<string>(['entry', 'memory']);
export const cacheScope = (row: SealedChange) => SCOPED.has(row.kind) ? row.parent! : '';
// A newer omission invalidates the old body; a same-revision echo must not erase a body already cached.
export const cacheNewer = (old: SealedChange | undefined, row: SealedChange) => !old || row.rev > old.rev || (row.rev === old.rev && old.omitted && !row.omitted);
