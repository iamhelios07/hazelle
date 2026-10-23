import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { alerts } from '../alerts';
import { diskBucket } from '../files/disk-bucket';
import { DAY_MS, sha256Hex } from '../http';
import { testApp } from '../testing';
import { backups } from './backups';
import { copyToFolder } from './folder';
import { COPIED, generationsDir, listGenerations } from './generation';
import { restoreGeneration } from './restore';

const HOUR_MS = 60 * 60 * 1000;

let t: Awaited<ReturnType<typeof testApp>>;
const scratch: string[] = [];
const emptyDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'hazelle-folder-'));
  scratch.push(dir);
  return dir;
};
beforeAll(async () => {
  t = await testApp();
});
beforeEach(async () => {
  await t.reset();
  t.env.backups = backups(t.dir, 3, alerts(null), async () => 50, 'folder');
  await t.env.db.prepare('UPDATE service SET backup_folder = NULL').run();
});
afterAll(() => {
  t.dispose();
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

it('copies each generation once into a folder a restore reads as it is, and marks it copied', async () => {
  const user = await t.signUp('owner');
  const bytes = new TextEncoder().encode('a picture') as Uint8Array<ArrayBuffer>;
  expect((await t.put(`files/${sha256Hex(bytes)}`, bytes, user.cookie)).status).toBe(204);
  expect((await t.daily(Date.now())).generation.outcome).toBe('ok');
  const folder = emptyDir();

  const [generation] = await listGenerations(t.dir);
  expect(await copyToFolder(t.dir, folder, Date.now())).toEqual({ copied: [generation!.id] });
  expect(existsSync(join(generationsDir(t.dir), generation!.id, COPIED))).toBe(true);
  expect(await copyToFolder(t.dir, folder, Date.now())).toEqual({ copied: [] });

  const destination = emptyDir();
  expect(await restoreGeneration(join(folder, generation!.id), destination, 'migrations', diskBucket(destination))).toMatchObject({ accounts: [{ id: user.id }], pictures: 1 });
});

it('thins the folder by the rule backup/ keeps, and copies nothing into a folder that is gone', async () => {
  await t.signUp('owner');
  const folder = emptyDir();
  const now = Date.now();
  for (let taken = 0; taken < 3; taken++) expect((await t.env.backups.fresh(t.env)).generation.outcome).toBe('ok');
  await copyToFolder(t.dir, folder, now);
  expect(readdirSync(folder).filter((name) => /^\d+-/.test(name))).toHaveLength(2);

  await expect(copyToFolder(t.dir, join(folder, 'unplugged'), now + DAY_MS)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(existsSync(join(folder, 'unplugged'))).toBe(false);
});

it('saves only a folder outside the data directory that it can write to, copies to it at once, and says why a pass failed', async () => {
  const { cookie } = await t.signUp('owner');
  expect((await t.daily(Date.now())).generation.outcome).toBe('ok');
  const put = (folder: string | null) => t.put('admin/backup-folder', { folder }, cookie);
  const answer = async (folder: string | null) => ((await (await put(folder)).json()) as { error: string }).error;
  expect(await answer('relative/path')).toBe('folder-not-absolute');
  expect(await answer(join(t.dir, 'inside'))).toBe('folder-in-data');
  const blocker = join(emptyDir(), 'a file');
  writeFileSync(blocker, '');
  expect(await answer(join(blocker, 'below'))).toBe('folder-unwritable');

  const folder = emptyDir();
  expect((await put(`"${folder}"`)).status).toBe(204);
  await t.settle();
  expect(readdirSync(folder).some((name) => /^\d+-/.test(name))).toBe(true);
  expect(await (await t.get('admin/service', cookie)).json()).toMatchObject({ backupFolder: { path: folder, failure: null }, warnings: [] });

  rmSync(folder, { recursive: true });
  await t.env.backups.tick(t.env, Date.now());
  expect(await (await t.get('admin/service', cookie)).json()).toMatchObject({ backupFolder: { path: folder, failure: 'missing' } });
});

it('asks no copy of a self-host until it names a folder, and from then on warns when copies stop', async () => {
  await t.signUp('owner');
  const later = Date.now() + 3 * DAY_MS;
  await t.env.db.prepare('UPDATE installation SET created_at = ?').bind(later - 40 * HOUR_MS).run();
  expect(await t.env.backups.freshness(t.env, later)).toMatchObject({ backupAgeHours: null, warnings: [] });
  await t.env.db.prepare('UPDATE service SET backup_folder = ?').bind(emptyDir()).run();
  expect(await t.env.backups.freshness(t.env, later)).toMatchObject({ warnings: ['backup-stale'] });
});
