import { randomBytes } from 'node:crypto';
import { open, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { makeDirs } from '../db/durable';
import { checkedKey, checkedPrefix, isPrefix, type DiskBucket } from './bucket';

// Pictures on disk, one directory per account incarnation, .tmp-* while a put runs.

const ID = /^[0-9a-f]{64}$/;

async function syncDir(dir: string): Promise<void> {
  const folder = await open(dir, 'r');
  try {
    await folder.sync();
  } finally {
    await folder.close();
  }
}

// ENOENT answers nothing: an account's deletion removes its directory while a listing walks it.
async function entries(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function mtime(path: string): Promise<number> {
  try {
    return (await stat(path)).mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Infinity;
    throw error;
  }
}

export function diskBucket(dataDir: string): DiskBucket {
  const path = (key: string) => join(dataDir, checkedKey(key));
  const directory = (prefix: string) => join(dataDir, checkedPrefix(prefix));
  const prefixes = async () => (await entries(join(dataDir, 'files'))).map((name) => `files/${name}/`).filter(isPrefix).sort();
  return {
    kind: 'disk',
    path,
    // The bytes reach the disk, then the name.
    put: async (key, body) => {
      const target = path(key);
      const dir = dirname(target);
      makeDirs(dir);
      const temp = join(dir, `.tmp-${randomBytes(8).toString('hex')}`);
      const file = await open(temp, 'w');
      try {
        await file.writeFile(body instanceof Uint8Array ? body : new Uint8Array(body));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, target);
      await syncDir(dir);
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
    list: async (prefix) => (await entries(directory(prefix))).filter((name) => ID.test(name)).sort().map((name) => `${prefix}${name}`),
    deletePrefix: async (prefix) => {
      await rm(directory(prefix), { recursive: true, force: true });
    },
    prefixes,
    sweep: async (settled) => {
      const removed: string[] = [];
      for (const prefix of await prefixes()) {
        for (const name of await entries(directory(prefix))) {
          if (!name.startsWith('.tmp-') || (await mtime(join(directory(prefix), name))) >= settled) continue;
          await rm(join(directory(prefix), name), { force: true });
          removed.push(`${prefix}${name}`);
        }
      }
      return removed;
    },
  };
}
