import { randomBytes } from 'node:crypto';
import { mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';

// Pictures on disk, one directory per account incarnation. reconcile.ts reads the same layout and removes the
// .tmp-* names put leaves behind a crash.

export type Bucket = {
  put(key: string, body: ArrayBuffer | Uint8Array): Promise<void>;
  get(key: string): Promise<ReadableStream<Uint8Array> | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  deletePrefix(prefix: string): Promise<void>;
};

// The path-traversal guard: keys come from validated route params, so a miss is a programming error.
const KEY = /^files\/[0-9a-f]{32}\/[0-9a-f]{64}$/;
const PREFIX = /^files\/[0-9a-f]{32}\/$/;
const ID = /^[0-9a-f]{64}$/;

export function diskBucket(dataDir: string): Bucket {
  const path = (key: string) => {
    if (!KEY.test(key)) throw new Error(`Not a file key: ${key}`);
    return join(dataDir, key);
  };
  const directory = (prefix: string) => {
    if (!PREFIX.test(prefix)) throw new Error(`Not a file prefix: ${prefix}`);
    return join(dataDir, prefix);
  };
  return {
    // A picture is durable before its row says stored: the bytes reach the disk, then the name, then the routes write
    // the row.
    put: async (key, body) => {
      const target = path(key);
      const dir = dirname(target);
      await mkdir(dir, { recursive: true });
      const temp = join(dir, `.tmp-${randomBytes(8).toString('hex')}`);
      const file = await open(temp, 'w');
      try {
        await file.writeFile(body instanceof Uint8Array ? body : new Uint8Array(body));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, target);
      const folder = await open(dir, 'r');
      try {
        await folder.sync();
      } finally {
        await folder.close();
      }
    },
    get: async (key) => {
      const target = path(key);
      try {
        const file = await open(target, 'r');
        return Readable.toWeb(file.createReadStream()) as unknown as ReadableStream<Uint8Array>;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    delete: async (key) => {
      await rm(path(key), { force: true });
    },
    list: async (prefix) => {
      const dir = directory(prefix);
      try {
        return (await readdir(dir)).filter((name) => ID.test(name)).sort().map((name) => `${prefix}${name}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
    },
    deletePrefix: async (prefix) => {
      await rm(directory(prefix), { recursive: true, force: true });
    },
  };
}
