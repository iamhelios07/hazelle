import { readdir, rm, rmdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from './db/service-db';

// The hourly sweep of what a crash or a late request left on disk. It reads the layout files/disk-bucket.ts writes
// (files/<incarnation>/<id>, .tmp-* while a put runs), the account databases and the snapshots.

// Younger than this, an entry may belong to a signup, an upload or a snapshot still being written.
const SETTLE_MS = 60 * 60 * 1000;
const ACCOUNT_DB = /^([0-9a-f]{32})\.sqlite(?:-wal|-shm)?$/;
const SNAPSHOT = '.sqlite.gz';

// ENOENT answers nothing: an account's deletion removes its files while the sweep walks them.
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

export async function reconcile(dataDir: string, db: Db, now = Date.now()): Promise<{ removed: string[] }> {
  const settled = now - SETTLE_MS;
  const removed: string[] = [];
  const remove = async (relative: string) => {
    await rm(join(dataDir, relative), { recursive: true, force: true });
    removed.push(relative);
  };
  const account = async (incarnation: string) => (await db.prepare('SELECT 1 FROM accounts WHERE incarnation = ?').bind(incarnation).first()) !== null;

  for (const incarnation of await entries(join(dataDir, 'files'))) {
    const dir = `files/${incarnation}`;
    if ((await mtime(join(dataDir, dir))) < settled && !(await account(incarnation))) {
      await remove(dir);
      continue;
    }
    for (const name of await entries(join(dataDir, dir))) {
      if (name.startsWith('.tmp-') && (await mtime(join(dataDir, dir, name))) < settled) await remove(`${dir}/${name}`);
    }
  }

  // A database and its -wal and -shm go together, and only when all three have settled.
  const databases = new Map<string, { names: string[]; newest: number }>();
  for (const name of await entries(join(dataDir, 'accounts'))) {
    const at = await mtime(join(dataDir, 'accounts', name));
    const incarnation = ACCOUNT_DB.exec(name)?.[1];
    if (incarnation === undefined) {
      if (at < settled) await remove(`accounts/${name}`);
      continue;
    }
    const group = databases.get(incarnation) ?? { names: [], newest: -Infinity };
    group.names.push(name);
    group.newest = Math.max(group.newest, at);
    databases.set(incarnation, group);
  }
  for (const [incarnation, { names, newest }] of databases) {
    if (newest < settled && !(await account(incarnation))) for (const name of names) await remove(`accounts/${name}`);
  }

  for (const incarnation of await entries(join(dataDir, 'snapshots'))) {
    const dir = `snapshots/${incarnation}`;
    const dirSettled = (await mtime(join(dataDir, dir))) < settled;
    const names = await entries(join(dataDir, dir));
    let left = names.length;
    for (const name of names) {
      const id = name.endsWith(SNAPSHOT) ? name.slice(0, -SNAPSHOT.length) : name;
      if ((await mtime(join(dataDir, dir, name))) >= settled) continue;
      if ((await db.prepare('SELECT 1 FROM snapshots WHERE id = ?').bind(id).first()) !== null) continue;
      await remove(`${dir}/${name}`);
      left--;
    }
    if (!dirSettled || left > 0) continue;
    // rmdir, not rm: it refuses a directory a snapshot was written into since the listing.
    try {
      await rmdir(join(dataDir, dir));
      removed.push(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error;
    }
  }
  return { removed };
}
