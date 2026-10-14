import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, link, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AccountState, RestorePhase } from '../../contracts/admin';
import { ACCOUNT_SCHEMA_VERSION, CURRENT_BASELINE, RETENTION_MS } from '../db/account-db';
import { fsyncPath, makeDirs } from '../db/durable';
import { archiveSnapshot, type SnapshotArchive } from '../db/snapshot';
import { fileKey, snapshotKey, type Bucket, type DiskBucket } from '../files/bucket';
import type { Services } from '../http';
import { DAY_MS, dayStart, pass, PINNED, staleBaselines, takeBaselines } from './snapshots';

// Backup generations (docs/research/docker-port-plan.md §10.2): backup/<id>/ holds the service snapshot, the
// snapshots its manifest names and, written last, manifest.json; with the disk bucket, pictures go once each into the
// shared pool backup/files/<sha256>. Every file a manifest names is a hard link (a copy across filesystems) taken while
// the gate held, so nothing deleted later in the live layout takes it from the generation. With the R2 bucket the
// manifest names pictures and archives where they are; removals wait until generations can no longer name them
// (reconcile.ts). The copier pools named archives off-site before it writes backup/<id>/copied; a generation is
// complete with both (src/server/db/README.md).

export const MANIFEST = 'manifest.json';
export const COPIED = 'copied';
export const POOL = 'files';
const GENERATION = /^(\d+)-[0-9a-f]{8}$/;

// bytes: the gzip on disk. expanded: what it gunzips to, measured on the plain file before it was gzipped (the gzip
// trailer holds that only modulo 4 GiB).
export type Artifact = { path: string } & SnapshotArchive;
// accounts: every account the service snapshot holds, with the snapshot its file is restored from: its current
// baseline, or, once its operation holds a checkpoint, that checkpoint, which is newer than any baseline and holds the
// file as it was at the fence: a restore cancels the operation before `armed` and from `armed` on finishes it, installing
// the target over that file. It is the one copy the account can have, since past the fence no baseline is taken
// (TAKES_BASELINE) and a finished rewind started a new timeline. Null only for a leaving one, whose deletion a restore
// finishes.
// pictureBytes: the sizes of its stored pictures, which a restore copies
// into every account that holds one. snapshots: those baselines, every snapshot an operation pins, and the base of each
// delta among them, each with `materialized`, an estimate of the file it restores to: a whole one's expanded, a delta's
// plus its base's, short by what the base's indexes grow over the delta's rows (scripts/destroy.sh sizes a drill by it,
// with its own margin). operations: those not done, and any not yet seen
// ending. bucket: where pictures are, the pool for disk, the R2 store for r2. pictures: ids, which are their SHA-256.
// snapshotStore: where every snapshots entry lives; disk means inside the generation, r2 names the source bucket.
// The copier pools R2 archives under snapshots/<bucket>/<incarnation>/<id>.sqlite.gz on the backup remote.
// pictures and migrations are the last two keys written, and bucket comes before them: deploy/rclone-backup.sh matches
// that tail and the version, and keeps only a disk generation's pictures in its pool.
export type Manifest = {
  version: 2 | 3 | 4;
  snapshotStore: { kind: 'disk' } | { kind: 'r2'; bucket: string };
  id: string;
  capturedAt: number;
  service: Artifact;
  migrations: string[];
  accountSchema: number;
  bucket: Bucket['kind'];
  accounts: { incarnation: string; state: AccountState; baseline: string | null; pictureBytes: number }[];
  snapshots: (Artifact & { id: string; incarnation: string; materialized: number })[];
  operations: { id: number; incarnation: string; phase: RestorePhase; verified: boolean; checkpoint: string | null; target: string | null }[];
  pictures: string[];
};

export const generationsDir = (dataDir: string) => join(dataDir, 'backup');

// A link where the source and the backup share a filesystem, a copy where they do not (pictures may move to their own
// volume). The copy is written under a .tmp-* name, synced and renamed, so every name here is whole: an existing
// target holds the same content (snapshot files and pictures are named by what they hold) and is not hashed again. A
// cut-off copy leaves only its .tmp-*, which the pool sweep (expireGenerations) or its generation's removal collects.
// The caller syncs the directory.
async function place(source: string, target: string) {
  try {
    await link(source, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return;
    if (code !== 'EXDEV') throw error;
    const temp = join(dirname(target), `.tmp-${randomBytes(8).toString('hex')}`);
    await copyFile(source, temp);
    fsyncPath(temp);
    await rename(temp, target);
  }
}

type Named = Omit<Manifest, 'version' | 'id' | 'capturedAt' | 'service' | 'accountSchema' | 'bucket' | 'snapshotStore'>;

// What the service snapshot names, read from the snapshot itself so the manifest and the service agree.
function readNamed(path: string, now: number): { named: Named; sources: Map<string, string[]> } {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const all = <T>(sql: string, ...binds: (string | number)[]) => db.prepare(sql).all(...binds) as T[];
    const accounts = all<Manifest['accounts'][number]>(
      `SELECT incarnation, state,
         COALESCE((SELECT checkpoint FROM restores WHERE id = a.operation), (${CURRENT_BASELINE('id', 'a', '?1')})) AS baseline,
         (SELECT COALESCE(SUM(size), 0) FROM account_files f WHERE f.incarnation = a.incarnation AND stored = 1) AS pictureBytes
       FROM accounts a ORDER BY incarnation`,
      now,
    );
    const unbacked = accounts.filter(({ state, baseline }) => state !== 'leaving' && baseline === null);
    if (unbacked.length) throw new Error(`generation: ${unbacked.length} accounts have no baseline`);
    const snapshots = all<Omit<Manifest['snapshots'][number], 'path'>>(
      `WITH named AS (SELECT id, base FROM snapshots s WHERE id IN (SELECT value FROM json_each(?1)) OR ${PINNED('s', '?2')})
       SELECT s.id, s.incarnation, s.bytes, s.expanded, s.sha256, s.expanded + COALESCE(b.expanded, 0) AS materialized
       FROM snapshots s LEFT JOIN snapshots b ON b.id = s.base
       WHERE s.id IN (SELECT id FROM named UNION SELECT base FROM named) ORDER BY s.incarnation, s.id`,
      JSON.stringify(accounts.map(({ baseline }) => baseline).filter((id) => id !== null)),
      now,
    );
    const operations = all<Omit<Manifest['operations'][number], 'verified'> & { verified: number }>(
      `SELECT id, incarnation, phase, verified, checkpoint, target FROM restores WHERE phase != 'done' OR verified = 0 ORDER BY id`,
    ).map((operation) => ({ ...operation, verified: Boolean(operation.verified) }));
    const sources = new Map<string, string[]>();
    for (const { incarnation, id } of all<{ incarnation: string; id: string }>('SELECT incarnation, id FROM account_files WHERE stored = 1 ORDER BY id, incarnation')) {
      sources.set(id, [...(sources.get(id) ?? []), incarnation]);
    }
    const migrations = all<{ name: string }>('SELECT name FROM migrations ORDER BY rowid').map(({ name }) => name);
    return {
      named: {
        accounts,
        snapshots: snapshots.map((snapshot) => ({ ...snapshot, path: snapshotKey(snapshot.incarnation, snapshot.id) })),
        operations,
        pictures: [...sources.keys()],
        migrations,
      },
      sources,
    };
  } finally {
    db.close();
  }
}

// Holds the gate (exclusive) while it brings every account's baseline up to its last finished rewind (and one restoring
// before its checkpoint current as of today), snapshots the service, and links what that snapshot names; compresses and writes
// the manifest after. now: the job's time, which names the generation; clock: that time moved on by the job's run, so
// the baselines the job itself took are never ahead of it. gateMs: how long lifecycle operations waited on it.
export async function captureGeneration(
  env: Services,
  dataDir: string,
  now: number,
  clock: () => number,
  exclusive: <T>(work: () => Promise<T>) => Promise<{ value: T; gateMs: number }>,
): Promise<{ id: string; gateMs: number; manifest: Manifest }> {
  const id = `${now}-${randomBytes(4).toString('hex')}`;
  const root = join(generationsDir(dataDir), id);
  const pool = join(generationsDir(dataDir), POOL);
  makeDirs(pool);
  makeDirs(root);
  const plain = join(root, 'service.sqlite');
  const { value: named, gateMs } = await exclusive(async () => {
    // An older baseline would restore the account as it was before its last rewind.
    const { failed } = await takeBaselines(env, await staleBaselines(env, clock(), 0));
    if (failed.length) throw new Error(`generation: ${failed.length} accounts could not be brought up to their last rewind`);
    await env.db.snapshot(plain);
    const { named, sources } = readNamed(plain, clock());
    const dirs = new Set<string>([pool]);
    const files = env.files;
    if (files.kind === 'disk') for (const snapshot of named.snapshots) {
      const target = join(root, snapshot.path);
      makeDirs(dirname(target));
      await place(files.path(snapshotKey(snapshot.incarnation, snapshot.id)), target);
      dirs.add(dirname(target));
    }
    if (files.kind === 'disk') {
      for (const [picture, holders] of sources) {
        await placePicture(files, join(pool, picture), picture, holders);
        await pass();
      }
    }
    for (const dir of dirs) fsyncPath(dir);
    return named;
  });
  const compressed = `${plain}.gz`;
  const artifact = await archiveSnapshot(plain, compressed);
  await rm(plain);
  const manifest: Manifest = {
    version: 4,
    id,
    capturedAt: now,
    service: { path: 'service.sqlite.gz', ...artifact },
    accountSchema: ACCOUNT_SCHEMA_VERSION,
    bucket: env.files.kind,
    snapshotStore: env.files.kind === 'disk' ? { kind: 'disk' } : { kind: 'r2', bucket: env.files.name },
    ...named,
  };
  const temp = join(root, `.tmp-${MANIFEST}`);
  const handle = await open(temp, 'w');
  try {
    await handle.writeFile(JSON.stringify(manifest));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, join(root, MANIFEST));
  fsyncPath(root);
  return { id, gateMs, manifest };
}

// Any account holding the picture is its source: the id is its content.
async function placePicture(files: DiskBucket, target: string, picture: string, holders: string[]) {
  for (const incarnation of holders) {
    try {
      await place(files.path(fileKey(incarnation, picture)), target);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`generation: picture ${picture} is stored but on no disk`);
}

// Version 1 was written before the R2 bucket, so its pictures are in the pool:
// 2 names whole snapshots only; 3 may name deltas beside their bases, and a build before it refuses one, since it would
// install a delta file as the account. Both keep archives in the generation even when pictures are in R2.
// Version 4 records the archive store; its bucket name also reaches the copier, which has no app-store environment.
export async function readManifest(root: string): Promise<Manifest | null> {
  try {
    const manifest = JSON.parse(await readFile(join(root, MANIFEST), 'utf8')) as Manifest | (Omit<Manifest, 'version' | 'bucket' | 'snapshotStore'> & { version: 1 });
    if (manifest.version === 1) return { ...manifest, version: 2, bucket: 'disk', snapshotStore: { kind: 'disk' } };
    return manifest.version === 2 || manifest.version === 3 ? { ...manifest, snapshotStore: { kind: 'disk' } } : manifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function listGenerations(dataDir: string): Promise<{ id: string; capturedAt: number }[]> {
  let names: string[];
  try {
    names = await readdir(generationsDir(dataDir));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return names.flatMap((name) => {
    const at = GENERATION.exec(name)?.[1];
    return at === undefined ? [] : [{ id: name, capturedAt: Number(at) }];
  });
}

// A generation goes at RETENTION_MS, one without a manifest (cut off before it was written) after a day, and a whole one
// that is neither among the two newest nor the newest of its UTC day once it has been copied off-site: every deploy
// captures one, and of those only the latest two are kept for a rollback (ruled 2026-10-12). Then every picture in the
// pool that no remaining disk generation names: an r2 one names pictures in the store, so the pool of the generations
// before a switch to R2 empties as they expire. Runs inside the daily job, so no capture is writing.
// deploy/rclone-backup.sh prune applies the same rule to the remote: change both together.
export async function expireGenerations(dataDir: string, now: number): Promise<{ removed: number; pictures: number }> {
  let removed = 0;
  let whole = 0;
  const days = new Set<number>();
  const kept = new Set<string>();
  for (const { id, capturedAt } of (await listGenerations(dataDir)).toSorted((a, b) => b.capturedAt - a.capturedAt)) {
    const root = join(generationsDir(dataDir), id);
    const manifest = await readManifest(root);
    let keep: boolean;
    if (manifest === null) keep = capturedAt > now - DAY_MS;
    else if (capturedAt <= now - RETENTION_MS) keep = false;
    else {
      const day = dayStart(capturedAt);
      keep = whole++ < 2 || !days.has(day) || !existsSync(join(root, COPIED));
      days.add(day);
    }
    if (!keep) {
      await rm(root, { recursive: true, force: true });
      removed++;
    } else if (manifest?.bucket === 'disk') for (const picture of manifest.pictures) kept.add(picture);
    await pass();
  }
  let pictures = 0;
  const pool = join(generationsDir(dataDir), POOL);
  for (const name of await readdir(pool).catch(() => [])) {
    if (kept.has(name)) continue;
    await rm(join(pool, name), { force: true });
    pictures++;
  }
  return { removed, pictures };
}
