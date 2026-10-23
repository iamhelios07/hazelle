import { existsSync } from 'node:fs';
import { access, readdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fsyncPath, makeDirs } from '../db/durable';
import { DEPARTURES } from './departures';
import { COPIED, copyWhole, generationsDir, listGenerations, MANIFEST, POOL, thinGenerations } from './generation';
import { pass } from './snapshots';

// A self-host's backup folder (the admin screen's 백업 폴더, service.backup_folder): another disk or a synced folder of
// the owner's machine, which holds backup/ in the layout deploy/rclone-backup.sh gives a remote, so restore.ts reads a
// generation there as it is. A disk-store installation outside a container only (node.ts): an R2 generation names
// archives this copy does not fetch, and inside a container a path is the container's own, gone at the next update.
//
// A pass: departures.json, then for every generation with a manifest and no copied marker the pool, its files, its
// manifest, then copied in the folder and in backup/; then the folder is thinned as backup/ is. A file already there
// under its name is whole (copyWhole) and named by what it holds, so a cut-off pass is finished by the next one.
export async function copyToFolder(dataDir: string, folder: string, now: number): Promise<{ copied: string[] }> {
  const local = generationsDir(dataDir);
  // No pool yet: the first generation has not begun.
  if (!existsSync(join(local, POOL))) return { copied: [] };
  // Never made here: a drive or card gone, a mount point left empty, would take the copies onto this disk unnoticed.
  await access(folder);
  if (existsSync(join(local, DEPARTURES))) await copyWhole(join(local, DEPARTURES), join(folder, DEPARTURES));
  const pending = (await listGenerations(dataDir)).filter(({ id }) => existsSync(join(local, id, MANIFEST)) && !existsSync(join(local, id, COPIED)));
  if (pending.length) await copyTree(join(local, POOL), join(folder, POOL));
  for (const { id } of pending) {
    await copyTree(join(local, id), join(folder, id), new Set([MANIFEST, COPIED]));
    await copyWhole(join(local, id, MANIFEST), join(folder, id, MANIFEST));
    const at = `${new Date(now).toISOString()}\n`;
    await writeFile(join(folder, id, COPIED), at);
    fsyncPath(join(folder, id));
    await writeFile(join(local, id, COPIED), at);
  }
  fsyncPath(folder);
  await thinGenerations(folder, now);
  return { copied: pending.map(({ id }) => id) };
}

async function copyTree(from: string, to: string, skip = new Set<string>()) {
  makeDirs(to);
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (skip.has(entry.name) || entry.name.startsWith('.tmp-')) continue;
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) await copyTree(source, target);
    else if (!existsSync(target)) await copyWhole(source, target);
    await pass();
  }
  fsyncPath(to);
}

// The folder as typed, or why it cannot hold the copies. Explorer's 경로로 복사 wraps a path in quotes. It is written to
// once here, so a folder this process cannot write to is refused before it is saved.
export async function checkFolder(dataDir: string, typed: string): Promise<{ ok: true; folder: string } | { ok: false; error: 'folder-not-absolute' | 'folder-in-data' | 'folder-unwritable' }> {
  const unquoted = typed.trim().replace(/^"(.*)"$/, '$1');
  if (!isAbsolute(unquoted)) return { ok: false, error: 'folder-not-absolute' };
  const folder = resolve(unquoted);
  const data = resolve(dataDir);
  const within = (child: string, parent: string) => !relative(parent, child).startsWith('..') && !isAbsolute(relative(parent, child));
  if (within(folder, data) || within(data, folder)) return { ok: false, error: 'folder-in-data' };
  const probe = join(folder, `.tmp-${Date.now()}`);
  try {
    makeDirs(folder);
    await writeFile(probe, '');
    await rm(probe);
  } catch {
    return { ok: false, error: 'folder-unwritable' };
  }
  return { ok: true, folder };
}
