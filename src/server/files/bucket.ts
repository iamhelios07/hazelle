// Where pictures live, keyed files/<incarnation>/<sha256>: the data directory (disk-bucket.ts) or an R2 bucket
// (r2-bucket.ts), chosen at startup (choose.ts). Every reader of that layout goes through a Bucket.

type Common = {
  // Durable once it answers: the routes write the row that says stored only after it.
  put(key: string, body: ArrayBuffer | Uint8Array): Promise<void>;
  get(key: string): Promise<ReadableStream<Uint8Array> | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  deletePrefix(prefix: string): Promise<void>;
  // Every incarnation's prefix that holds a picture, for the sweep of deleted accounts' pictures (reconcile.ts).
  prefixes(): Promise<string[]>;
};

// path: the file holding a key, which a backup generation hard-links into its pool. sweep: removes what a put cut off
// before settled left behind and answers those names.
export type DiskBucket = Common & { kind: 'disk'; path(key: string): string; sweep(settled: number): Promise<string[]> };
// The store outlives the machine, so a backup generation names its pictures here instead of copying them
// (backup/generation.ts). head: a key's size, null when absent.
export type R2Bucket = Common & { kind: 'r2'; head(key: string): Promise<number | null> };
export type Bucket = DiskBucket | R2Bucket;

// The path-traversal guard: keys come from validated route params, so a miss is a programming error.
const KEY = /^files\/[0-9a-f]{32}\/[0-9a-f]{64}$/;
const PREFIX = /^files\/[0-9a-f]{32}\/$/;

export function checkedKey(key: string): string {
  if (!KEY.test(key)) throw new Error(`Not a file key: ${key}`);
  return key;
}

export function checkedPrefix(prefix: string): string {
  if (!PREFIX.test(prefix)) throw new Error(`Not a file prefix: ${prefix}`);
  return prefix;
}

export const isKey = (key: string) => KEY.test(key);
export const isPrefix = (prefix: string) => PREFIX.test(prefix);
export const filePrefix = (incarnation: string) => `files/${incarnation}/`;
export const fileKey = (incarnation: string, id: string) => `${filePrefix(incarnation)}${id}`;
