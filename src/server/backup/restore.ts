import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, open, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import type { ExecutionContext } from 'hono';
import type { Phase } from '../account-store';
import { serviceReads } from '../account-store';
import { accountPath, accountRegistry, installSnapshot, snapshotPath } from '../db/account-db';
import { migrate } from '../db/migrate';
import { openDatabase, serviceDb } from '../db/service-db';
import { diskBucket } from '../files/disk-bucket';
import type { Services } from '../http';
import { cancelRestore, leaveAccount, runRestore } from '../lifecycle';
import { tokenBucket } from '../limits';
import { streamRegistry } from '../stream-registry';
import { streamStore } from '../db/streams-db';
import { backups } from './backups';
import { POOL, readManifest, type Manifest } from './generation';

// The disaster restore (docs/research/docker-port-plan.md §10.2): one generation directory, beside the pool it was
// copied with (<generation>/../files), into an empty data directory. Every hash is checked before anything is
// written. The service goes in before the pictures, since the hourly reconciliation removes a picture directory no
// account names; the server must not start until this has finished. Pending operations are then resolved through the
// live server's own lifecycle code, and every account gets a fresh timeline, so a device holding an older one re-pulls.

const BEFORE_ARMED: Phase[] = ['begun', 'fenced', 'checkpointed', 'targeted'];

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) hash.update(chunk);
  return hash.digest('hex');
}

async function fsyncPath(path: string) {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function gunzipTo(source: string, target: string) {
  await mkdir(dirname(target), { recursive: true });
  await pipeline(createReadStream(source), createGunzip(), createWriteStream(target, { flags: 'wx' }));
  await fsyncPath(target);
}

async function copyInto(source: string, target: string) {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  await fsyncPath(target);
}

// Throws on the first artifact that is missing or does not hash to what the manifest says.
async function verify(generation: string, manifest: Manifest) {
  const check = async (path: string, expected: string) => {
    const actual = await sha256(path).catch(() => 'missing');
    if (actual !== expected) throw new Error(`restore: ${path} is ${actual === 'missing' ? 'missing' : 'corrupt'}`);
  };
  await check(join(generation, manifest.service.path), manifest.service.sha256);
  for (const snapshot of manifest.snapshots) await check(join(generation, snapshot.path), snapshot.sha256);
  for (const picture of manifest.pictures) await check(join(generation, '..', POOL, picture), picture);
}

export type Restored = { accounts: number; pictures: number; operations: { id: number; phase: Phase }[]; deleted: number };

export async function restoreGeneration(generation: string, dataDir: string, migrationsDir: string): Promise<Restored> {
  const manifest = await readManifest(generation);
  if (manifest === null) throw new Error(`restore: ${generation} has no manifest; it is not a complete generation`);
  if (manifest.version !== 1) throw new Error(`restore: manifest version ${manifest.version} is not one this build reads`);
  await mkdir(dataDir, { recursive: true });
  if ((await readdir(dataDir)).length) throw new Error(`restore: ${dataDir} is not empty`);
  await verify(generation, manifest);

  await gunzipTo(join(generation, manifest.service.path), join(dataDir, 'service.sqlite'));
  const raw = openDatabase(join(dataDir, 'service.sqlite'));
  migrate(raw, migrationsDir);
  const db = serviceDb(raw);
  // The catalog names every snapshot the source had; only the generation's came along.
  await db.prepare('DELETE FROM snapshots WHERE id NOT IN (SELECT value FROM json_each(?))').bind(JSON.stringify(manifest.snapshots.map(({ id }) => id))).run();
  for (const snapshot of manifest.snapshots) await copyInto(join(generation, snapshot.path), snapshotPath(dataDir, snapshot.incarnation, snapshot.id));
  await mkdir(join(dataDir, 'accounts'), { recursive: true });
  // A fenced account has not changed since its checkpoint, which is newer than any baseline of it.
  const fenced = new Map(manifest.operations.flatMap(({ incarnation, phase, checkpoint }) => (BEFORE_ARMED.includes(phase) && checkpoint !== null ? [[incarnation, checkpoint]] : [])));
  for (const { incarnation, baseline } of manifest.accounts) {
    const source = fenced.get(incarnation) ?? baseline;
    if (source !== null) await gunzipTo(snapshotPath(dataDir, incarnation, source), accountPath(dataDir, incarnation));
  }
  // Past its install already: the live file was the target when the generation was taken.
  for (const { id, incarnation, phase, target } of manifest.operations) if (phase === 'rewound') await installSnapshot(dataDir, db, incarnation, target!, id);
  const { results: pictures } = await db.prepare('SELECT incarnation, id FROM account_files WHERE stored = 1').all<{ incarnation: string; id: string }>();
  for (const { incarnation, id } of pictures) await copyInto(join(generation, '..', POOL, id), join(dataDir, 'files', incarnation, id));
  for (const dir of ['', 'accounts', 'snapshots', 'files']) await fsyncPath(join(dataDir, dir)).catch(() => {});

  const outbound = () => Promise.reject(new Error('A restore calls no provider.'));
  const env: Services = {
    db,
    files: diskBucket(dataDir),
    stores: accountRegistry(dataDir, db, serviceReads(db), Date.now),
    streams: streamRegistry(streamStore(':memory:'), outbound),
    outbound,
    limits: { calls: tokenBucket(1), botCalls: tokenBucket(1) },
    backups: backups(dataDir, 0, null),
  };
  try {
    const operations: Restored['operations'] = [];
    for (const { id } of manifest.operations) {
      const { phase } = (await db.prepare('SELECT phase FROM restores WHERE id = ?').bind(id).first<{ phase: Phase }>())!;
      const ended = BEFORE_ARMED.includes(phase) ? await cancelRestore(env, id) : await runRestore(env, id);
      if (ended === null || ended === 'too-late' || !ended.verified) throw new Error(`restore: operation ${id} did not end (${JSON.stringify(ended)})`);
      operations.push({ id, phase: ended.phase });
    }
    const { results: leaving } = await db.prepare("SELECT id, incarnation FROM accounts WHERE state = 'leaving'").all<{ id: string; incarnation: string }>();
    const after: Promise<unknown>[] = [];
    const ctx: Pick<ExecutionContext, 'waitUntil'> = { waitUntil: (work) => void after.push(work) };
    for (const { id, incarnation } of leaving) {
      const left = await leaveAccount(env, ctx, id, incarnation, true);
      if (left !== 'left') throw new Error(`restore: the deletion of ${id} did not finish (${left})`);
    }
    await Promise.all(after);
    await db.prepare('UPDATE accounts SET timeline = lower(hex(randomblob(16)))').run();
    const accounts = (await db.prepare('SELECT COUNT(*) AS n FROM accounts').first<number>('n'))!;
    const stored = (await db.prepare('SELECT COUNT(*) AS n FROM account_files WHERE stored = 1').first<number>('n'))!;
    return { accounts, pictures: stored, operations, deleted: leaving.length };
  } finally {
    env.stores.close();
    raw.close();
  }
}
