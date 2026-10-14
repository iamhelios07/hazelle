import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { generationsDir, listGenerations, readManifest } from './backup/generation';
import { RETENTION_MS } from './db/account-db';
import type { Db } from './db/service-db';
import { filePrefix, type Bucket } from './files/bucket';

// The hourly sweep of what a crash or a late request left behind: the picture store, the account databases and the
// snapshots; and the trim of the R2 store's copy on disk (files/cached-r2-bucket.ts).

// Younger than this, an entry may belong to a signup, an upload or a snapshot still being written.
const SETTLE_MS = 60 * 60 * 1000;
const ACCOUNT_DB = /^([0-9a-f]{32})\.sqlite(?:-wal|-shm)?$/;

// A deleted account's pictures. On disk they go at once: a backup generation holds its own copies in its pool. In R2 a
// generation names them where they are, so they go once every generation that could name them has expired.
export async function removePictures(files: Bucket, db: Db, incarnation: string, now: number): Promise<void> {
  if (files.kind === 'disk') return files.deletePrefix(filePrefix(incarnation));
  await db.prepare('INSERT INTO picture_removals (incarnation, due_at) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(incarnation, now + RETENTION_MS).run();
}

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

export async function reconcile(dataDir: string, db: Db, files: Bucket, now = Date.now()): Promise<{ removed: string[] }> {
  const settled = now - SETTLE_MS;
  const removed: string[] = [];
  const remove = async (relative: string) => {
    await rm(join(dataDir, relative), { recursive: true, force: true });
    removed.push(relative);
  };
  const account = async (incarnation: string) => (await db.prepare('SELECT 1 FROM accounts WHERE incarnation = ?').bind(incarnation).first()) !== null;

  // At any age: only a reservation, which needs the account's row, writes under a prefix, so what lands there once the
  // row is gone is an upload that outlived its account.
  for (const prefix of await files.prefixes()) {
    const incarnation = prefix.slice('files/'.length, -1);
    if (await account(incarnation)) continue;
    await removePictures(files, db, incarnation, now);
    if (files.kind === 'disk') removed.push(`files/${incarnation}`);
  }
  if (files.kind === 'r2') removed.push(...(await files.trim(now)));
  const { results: due } = await db.prepare('SELECT incarnation FROM picture_removals WHERE due_at <= ?').bind(now).all<{ incarnation: string }>();
  for (const { incarnation } of due) {
    await files.deletePrefix(filePrefix(incarnation));
    await db.prepare('DELETE FROM picture_removals WHERE incarnation = ?').bind(incarnation).run();
    removed.push(`files/${incarnation}`);
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

  const catalogued = async (key: string) => (await db.prepare('SELECT 1 FROM snapshots WHERE incarnation = ? AND id = ?').bind(key.split('/')[1]!, key.split('/')[2]!.slice(0, -'.sqlite.gz'.length)).first()) !== null;
  for (const { key, modified } of await files.archives()) {
    if (await catalogued(key)) {
      await db.prepare('DELETE FROM snapshot_removals WHERE key = ?').bind(key).run();
      continue;
    }
    if (files.kind === 'r2') {
      // Starts at discovery, not capture: a generation may have named an old snapshot just before its row expired.
      await db.prepare('INSERT INTO snapshot_removals (key, due_at) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(key, now + RETENTION_MS).run();
    } else if (modified < settled) {
      await files.delete(key);
      removed.push(key);
    }
  }
  const { results: archives } = await db.prepare('SELECT key FROM snapshot_removals WHERE due_at <= ?').bind(now).all<{ key: string }>();
  const named = new Set<string>();
  if (archives.length) for (const { id } of await listGenerations(dataDir)) {
    const manifest = await readManifest(join(generationsDir(dataDir), id));
    if (manifest?.version === 4 && manifest.snapshotStore.kind === 'r2') for (const snapshot of manifest.snapshots) named.add(snapshot.path);
  }
  for (const { key } of archives) {
    // Expiry of generations runs daily and can fail; a still-present local generation remains a rollback source.
    if (named.has(key)) continue;
    if (!(await catalogued(key))) {
      await files.delete(key);
      removed.push(key);
    }
    await db.prepare('DELETE FROM snapshot_removals WHERE key = ?').bind(key).run();
  }
  if (files.kind === 'disk') removed.push(...(await files.sweep(settled)));
  return { removed };
}
