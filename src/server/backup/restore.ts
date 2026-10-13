import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import type { ExecutionContext } from 'hono';
import type { RestorePhase } from '../../contracts/admin';
import { serviceReads } from '../account-store';
import { accountPath, accountRegistry, installSnapshot, materializeSnapshot, snapshotPath } from '../db/account-db';
import { digest, fsyncPath, makeDirs } from '../db/durable';
import { migrate } from '../db/migrate';
import { openDatabase, serviceDb } from '../db/service-db';
import { fileKey, type Bucket, type R2Bucket } from '../files/bucket';
import type { Services } from '../http';
import { cancelRestore, leaveAccount, runRestore } from '../lifecycle';
import { tokenBucket, visitorLimits } from '../limits';
import { streamRegistry } from '../stream-registry';
import { streamStore } from '../db/streams-db';
import { alerts } from '../alerts';
import { backups } from './backups';
import { POOL, readManifest, type Manifest } from './generation';

// The disaster restore (docs/research/docker-port-plan.md §10.2): one generation directory, beside the pool it was
// copied with (<generation>/../files), into an empty data directory and the picture store the environment names. Every
// hash is checked before anything is written; a generation whose pictures are in R2 is checked there by size only,
// before anything but the service file is written. The service goes in before the pictures, since the hourly
// reconciliation removes a picture prefix no account names; the server must not start until this has finished. Pending
// operations are then resolved through the live server's own lifecycle code, and every account gets a fresh timeline,
// so a device holding an older one re-pulls.

const BEFORE_ARMED: RestorePhase[] = ['begun', 'fenced', 'checkpointed', 'targeted'];
const HEADS = 16;

async function copyInto(source: string, target: string) {
  makeDirs(dirname(target));
  await copyFile(source, target);
  fsyncPath(target);
}

async function verify(generation: string, manifest: Manifest, files: Bucket) {
  if (manifest.bucket === 'r2' && files.kind !== 'r2') throw new Error('restore: the generation’s pictures are in an R2 bucket; set HAZELLE_FILES_BUCKET=r2 and its HAZELLE_FILES_R2_* to that bucket');
  const check = async (path: string, expected: string) => {
    const actual = await digest(path).then(({ sha256 }) => sha256, () => 'missing');
    if (actual !== expected) throw new Error(`restore: ${path} is ${actual === 'missing' ? 'missing' : 'corrupt'}`);
  };
  await check(join(generation, manifest.service.path), manifest.service.sha256);
  for (const snapshot of manifest.snapshots) await check(join(generation, snapshot.path), snapshot.sha256);
  if (manifest.bucket === 'disk') for (const picture of manifest.pictures) await check(join(generation, '..', POOL, picture), picture);
}

// Every stored picture the service names is in the store at the size its row records, or the restore fails naming each
// one that is not. Sizes only: reading every object back to hash it is not done.
async function inStore(files: R2Bucket, service: string) {
  const db = new DatabaseSync(service, { readOnly: true });
  let stored: { incarnation: string; id: string; size: number }[];
  try {
    stored = db.prepare('SELECT incarnation, id, size FROM account_files WHERE stored = 1 ORDER BY incarnation, id').all() as typeof stored;
  } finally {
    db.close();
  }
  const wrong: string[] = [];
  for (let start = 0; start < stored.length; start += HEADS) {
    await Promise.all(
      stored.slice(start, start + HEADS).map(async ({ incarnation, id, size }) => {
        const found = await files.head(fileKey(incarnation, id));
        if (found !== size) wrong.push(`${fileKey(incarnation, id)}: ${found === null ? 'missing' : `${found} bytes, not ${size}`}`);
      }),
    );
  }
  if (wrong.length) throw new Error(`restore: ${wrong.length} of ${stored.length} pictures are not in the R2 bucket as the generation names them:\n${wrong.sort().join('\n')}`);
}

export type Restored = { accounts: number; pictures: number; operations: { id: number; phase: RestorePhase }[]; deleted: number };

export async function restoreGeneration(generation: string, dataDir: string, migrationsDir: string, files: Bucket): Promise<Restored> {
  const manifest = await readManifest(generation);
  // No `copied` needed: that marker is for freshness and the copier; a generation with its manifest and verified
  // hashes is a whole restore source wherever it lies.
  if (manifest === null) throw new Error(`restore: ${generation} has no manifest; it is not a complete generation`);
  if (manifest.version !== 2 && manifest.version !== 3) throw new Error(`restore: manifest version ${manifest.version} is not one this build reads`);
  await mkdir(dataDir, { recursive: true });
  if ((await readdir(dataDir)).length) throw new Error(`restore: ${dataDir} is not empty`);
  await verify(generation, manifest, files);

  const service = join(dataDir, 'service.sqlite');
  await pipeline(createReadStream(join(generation, manifest.service.path)), createGunzip(), createWriteStream(service, { flags: 'wx' }));
  fsyncPath(service);
  // verify refused an r2 generation into any other bucket. A failure leaves the directory empty, as it found it.
  if (manifest.bucket === 'r2' && files.kind === 'r2') {
    await inStore(files, service).catch(async (error: unknown) => {
      for (const suffix of ['', '-wal', '-shm']) await rm(join(dataDir, `service.sqlite${suffix}`), { force: true });
      throw error;
    });
  }
  const raw = openDatabase(service);
  migrate(raw, migrationsDir);
  const db = serviceDb(raw);
  // The catalog names every snapshot the source had; only the generation's came along.
  await db.prepare('DELETE FROM snapshots WHERE id NOT IN (SELECT value FROM json_each(?))').bind(JSON.stringify(manifest.snapshots.map(({ id }) => id))).run();
  for (const snapshot of manifest.snapshots) await copyInto(join(generation, snapshot.path), snapshotPath(dataDir, snapshot.incarnation, snapshot.id));
  await mkdir(join(dataDir, 'accounts'), { recursive: true });
  // A version 2 manifest names a baseline for every account, and a fenced one has not changed since its checkpoint,
  // which is newer; version 3 names that checkpoint as the account's source itself (generation.ts readNamed).
  const fenced = new Map(manifest.version === 2 ? manifest.operations.flatMap(({ incarnation, phase, checkpoint }) => (BEFORE_ARMED.includes(phase) && checkpoint !== null ? [[incarnation, checkpoint]] : [])) : []);
  for (const { incarnation, baseline } of manifest.accounts) {
    const source = fenced.get(incarnation) ?? baseline;
    if (source === null) continue;
    await materializeSnapshot(dataDir, db, incarnation, source, accountPath(dataDir, incarnation));
    fsyncPath(accountPath(dataDir, incarnation));
  }
  // Past its install already: the live file was the target when the generation was taken.
  for (const { id, incarnation, phase, target } of manifest.operations) if (phase === 'rewound') await installSnapshot(dataDir, db, incarnation, target!, id);
  const { results: pictures } = await db.prepare('SELECT incarnation, id FROM account_files WHERE stored = 1').all<{ incarnation: string; id: string }>();
  if (manifest.bucket === 'disk') for (const { incarnation, id } of pictures) await files.put(fileKey(incarnation, id), await readFile(join(generation, '..', POOL, id)));
  for (const dir of ['', 'accounts', 'snapshots']) {
    try {
      fsyncPath(join(dataDir, dir));
    } catch {
      // A generation without pictures or snapshots leaves that directory unmade.
    }
  }

  const outbound = () => Promise.reject(new Error('A restore calls no provider.'));
  const env: Services = {
    db,
    files,
    stores: accountRegistry(dataDir, db, serviceReads(db), Date.now),
    streams: streamRegistry(streamStore(':memory:'), outbound),
    outbound,
    localProviders: new Set(),
    limits: { calls: tokenBucket(1), botCalls: tokenBucket(1), visitors: visitorLimits() },
    backups: backups(dataDir, 0, alerts(null)),
  };
  try {
    const operations: Restored['operations'] = [];
    for (const { id } of manifest.operations) {
      const { phase } = (await db.prepare('SELECT phase FROM restores WHERE id = ?').bind(id).first<{ phase: RestorePhase }>())!;
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
