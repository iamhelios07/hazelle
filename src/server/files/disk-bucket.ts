import { randomBytes } from 'node:crypto';
import { copyFile, open, readdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { makeDirs } from '../db/durable';
import { checkedKey, checkedPrefix, isKey, isPrefix, type DiskBucket } from './bucket';

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
  // The bytes reach the disk, then the name.
  const publish = async (key: string, write: (temp: string) => Promise<void>) => {
    const target = path(key);
    const dir = dirname(target);
    makeDirs(dir);
    const temp = join(dir, `.tmp-${randomBytes(8).toString('hex')}`);
    try {
      await write(temp);
      const file = await open(temp, 'r');
      try {
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, target);
      await syncDir(dir);
    } finally {
      await rm(temp, { force: true });
    }
  };
  return {
    kind: 'disk',
    putFile: (key, source) => publish(key, (temp) => copyFile(source, temp)),
    archives: async () => {
      const found: { key: string; modified: number }[] = [];
      for (const incarnation of await entries(join(dataDir, 'snapshots'))) {
        for (const name of await entries(join(dataDir, 'snapshots', incarnation))) {
          const key = `snapshots/${incarnation}/${name}`;
          if (isKey(key)) found.push({ key, modified: await mtime(path(key)) });
        }
      }
      return found;
    },
    path,
    put: (key, body) => publish(key, (temp) => writeFile(temp, body instanceof Uint8Array ? body : new Uint8Array(body))),
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
      for (const prefix of [...(await prefixes()), ...(await entries(join(dataDir, 'snapshots'))).filter((name) => /^[0-9a-f]{32}$/.test(name)).map((name) => `snapshots/${name}/`)]) {
        const dir = join(dataDir, prefix);
        const dirSettled = (await mtime(dir)) < settled;
        for (const name of await entries(dir)) {
          if (!name.startsWith('.tmp-') || (await mtime(join(dataDir, prefix, name))) >= settled) continue;
          await rm(join(dataDir, prefix, name), { force: true });
          removed.push(`${prefix}${name}`);
        }
        if (prefix.startsWith('snapshots/') && dirSettled) {
          // rmdir, not rm: it refuses a directory a snapshot was written into since the listing.
          try {
            await rmdir(dir);
            removed.push(prefix.slice(0, -1));
          } catch (error) {
            if (!['ENOTEMPTY', 'ENOENT'].includes((error as NodeJS.ErrnoException).code!)) throw error;
          }
        }
      }
      return removed;
    },
  };
}
