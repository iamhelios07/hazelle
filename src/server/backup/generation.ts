import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, link, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import type { Phase } from '../account-store';
import { ACCOUNT_SCHEMA_VERSION, RETENTION_MS, snapshotPath } from '../db/account-db';
import { digest, fsyncPath, makeDirs } from '../db/durable';
import type { Services } from '../http';
import { DAY_MS, pass, PINNED, staleBaselines, takeBaselines } from './snapshots';

// Backup generations (docs/research/docker-port-plan.md §10.2): backup/<id>/ holds the service snapshot, the
// snapshots its manifest names and, written last, manifest.json; pictures go once each into the shared pool
// backup/files/<sha256>. Every file a manifest names is a hard link (a copy across filesystems) taken while the gate
// held, so nothing deleted later in the live layout takes it from the generation. The copier writes backup/<id>/copied
// after it copied the directory; a generation is complete with both (src/server/db/README.md).

export const MANIFEST = 'manifest.json';
export const COPIED = 'copied';
export const POOL = 'files';
const GENERATION = /^(\d+)-[0-9a-f]{8}$/;

// bytes: the gzip on disk. expanded: what it gunzips to; a snapshot's is its gzip trailer, which holds that modulo 4 GiB.
export type Artifact = { path: string; bytes: number; sha256: string; expanded: number };
// accounts: every account the service snapshot holds, with the baseline its file is restored from; null only for a
// leaving one, whose deletion a restore finishes. pictureBytes: the sizes of its stored pictures, which a restore copies
// into every account that holds one. snapshots: those baselines, and every snapshot an operation pins. operations:
// those not done, and any not yet seen ending. pictures: ids, which are their SHA-256, in the pool. pictures and
// migrations are the last two keys written: deploy/rclone-backup.sh matches that tail.
export type Manifest = {
  version: 1;
  id: string;
  capturedAt: number;
  service: Artifact;
  migrations: string[];
  accountSchema: number;
  accounts: { incarnation: string; state: 'active' | 'restoring' | 'leaving'; baseline: string | null; pictureBytes: number }[];
  snapshots: (Artifact & { id: string; incarnation: string })[];
  operations: { id: number; incarnation: string; phase: Phase; verified: boolean; checkpoint: string | null; target: string | null }[];
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

type Named = Omit<Manifest, 'version' | 'id' | 'capturedAt' | 'service' | 'accountSchema' | 'snapshots'> & {
  snapshots: Omit<Manifest['snapshots'][number], 'expanded'>[];
};

// What the service snapshot names, read from the snapshot itself so the manifest and the service agree.
function readNamed(path: string, now: number): { named: Named; sources: Map<string, string[]> } {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const all = <T>(sql: string, ...binds: (string | number)[]) => db.prepare(sql).all(...binds) as T[];
    const accounts = all<Manifest['accounts'][number]>(
      `SELECT incarnation, state,
         (SELECT id FROM snapshots s WHERE s.incarnation = a.incarnation AND kind = 'baseline' AND taken_at <= ?1 ORDER BY taken_at DESC, id DESC LIMIT 1) AS baseline,
         (SELECT COALESCE(SUM(size), 0) FROM account_files f WHERE f.incarnation = a.incarnation AND stored = 1) AS pictureBytes
       FROM accounts a ORDER BY incarnation`,
      now,
    );
    const unbacked = accounts.filter(({ state, baseline }) => state !== 'leaving' && baseline === null);
    if (unbacked.length) throw new Error(`generation: ${unbacked.length} accounts have no baseline`);
    const snapshots = all<{ id: string; incarnation: string; bytes: number; sha256: string }>(
      `SELECT id, incarnation, bytes, sha256 FROM snapshots s
       WHERE id IN (SELECT value FROM json_each(?1)) OR ${PINNED('s', '?2')} ORDER BY incarnation, id`,
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
        snapshots: snapshots.map((snapshot) => ({ ...snapshot, path: `snapshots/${snapshot.incarnation}/${snapshot.id}.sqlite.gz` })),
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
    await env.db.prepare(`VACUUM INTO '${plain.replaceAll("'", "''")}'`).run();
    const { named, sources } = readNamed(plain, clock());
    const dirs = new Set<string>([pool]);
    for (const snapshot of named.snapshots) {
      const target = join(root, snapshot.path);
      makeDirs(dirname(target));
      await place(snapshotPath(dataDir, snapshot.incarnation, snapshot.id), target);
      dirs.add(dirname(target));
    }
    for (const [picture, holders] of sources) {
      await placePicture(dataDir, join(pool, picture), picture, holders);
      await pass();
    }
    for (const dir of dirs) fsyncPath(dir);
    return named;
  });
  const compressed = `${plain}.gz`;
  await pipeline(createReadStream(plain), createGzip(), createWriteStream(compressed));
  fsyncPath(compressed);
  const { size: expanded } = await stat(plain);
  await rm(plain);
  const snapshots: Manifest['snapshots'] = [];
  for (const snapshot of named.snapshots) snapshots.push({ ...snapshot, expanded: await gunzippedBytes(join(root, snapshot.path)) });
  const manifest: Manifest = {
    version: 1,
    id,
    capturedAt: now,
    service: { path: 'service.sqlite.gz', ...(await digest(compressed)), expanded },
    accountSchema: ACCOUNT_SCHEMA_VERSION,
    ...named,
    snapshots,
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

async function gunzippedBytes(path: string) {
  const handle = await open(path, 'r');
  try {
    const trailer = Buffer.alloc(4);
    await handle.read(trailer, 0, 4, (await handle.stat()).size - 4);
    return trailer.readUInt32LE(0);
  } finally {
    await handle.close();
  }
}

// Any account holding the picture is its source: the id is its content.
async function placePicture(dataDir: string, target: string, picture: string, holders: string[]) {
  for (const incarnation of holders) {
    try {
      await place(join(dataDir, 'files', incarnation, picture), target);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`generation: picture ${picture} is stored but on no disk`);
}

export async function readManifest(root: string): Promise<Manifest | null> {
  try {
    return JSON.parse(await readFile(join(root, MANIFEST), 'utf8')) as Manifest;
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

// A generation goes at RETENTION_MS, and one without a manifest (cut off before it was written) after a day; then every
// picture in the pool that no remaining manifest names. Runs inside the daily job, so no capture is writing.
export async function expireGenerations(dataDir: string, now: number): Promise<{ removed: number; pictures: number }> {
  let removed = 0;
  const kept = new Set<string>();
  for (const { id, capturedAt } of await listGenerations(dataDir)) {
    const root = join(generationsDir(dataDir), id);
    const manifest = await readManifest(root);
    if (capturedAt <= now - RETENTION_MS || (manifest === null && capturedAt <= now - DAY_MS)) {
      await rm(root, { recursive: true, force: true });
      removed++;
    } else if (manifest) for (const picture of manifest.pictures) kept.add(picture);
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
