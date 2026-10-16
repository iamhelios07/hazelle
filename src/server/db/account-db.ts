import type { SnapshotKind } from '../../contracts/admin';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { StoreRules, type SqlValue, type StoreDb, type StoreReads, type Unavailable } from '../account-store';
import { snapshotKey, type Bucket } from '../files/bucket';
import { fsyncPath, makeDirs } from './durable';
import { openDatabase, type Db } from './service-db';
import { archiveSnapshot } from './snapshot';
import { transaction } from './transaction';

// One account's database file, accounts/<incarnation>.sqlite, behind StoreRules (account-store.ts), and the registry
// that owns every open file: one serial queue per incarnation, a replaceable session, the install of an armed restore
// when a session starts, and the bounds of §3 (handles, idle eviction). The layout is docs/research/docker-port-plan.md §4.

// Bumped with every change to SCHEMA; a file carrying a newer number is refused, never downgraded.
export const ACCOUNT_SCHEMA_VERSION = 1;
const SCHEMA = [
  'CREATE TABLE head (id INTEGER PRIMARY KEY CHECK (id = 1), rev INTEGER NOT NULL, bytes INTEGER NOT NULL, timeline TEXT NOT NULL, schema_version INTEGER NOT NULL, installed_from TEXT, installed_op INTEGER)',
  'CREATE TABLE objects (id TEXT PRIMARY KEY, kind TEXT NOT NULL, parent_id TEXT, rev INTEGER NOT NULL, body TEXT, deleted_at INTEGER)',
  // The global cursor stays in revision order, including omitted bodies.
  'CREATE INDEX objects_rev ON objects (rev, kind, parent_id, id, deleted_at)',
  'CREATE INDEX objects_parent_rev ON objects (parent_id, rev)',
  'CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
];
// Over an accounts row aliased `a`: whether a baseline may be taken of the account's file now. Before an operation's
// checkpoint the file is still the account's own; from the checkpoint until the operation ends it is about to be
// replaced or already was, and a baseline taken then would read, once the rewind is done, as the account after it.
export const TAKES_BASELINE = (a: string) =>
  `(${a}.state = 'active' OR (${a}.state = 'restoring' AND (SELECT phase FROM restores WHERE id = ${a}.operation) IN ('begun', 'fenced')))`;
// Over an accounts row aliased `a` and a time `now` (a bind): `column` of the account's current baseline, its newest
// on the account's timeline taken by `now`, or null. A rewind replaces the file and starts a timeline, and the installed
// head.rev can equal the one an older baseline recorded, so only the current baseline's rev says the file is unchanged.
// Rows from before migration 0007 have no timeline and never count, and a baseline stamped after `now` is evidence of a
// clock since put back, not of the account's state; the same clock would stamp a rewind's ended_at before the baselines
// of the state it replaced, which is why time does not stand in for the timeline here or in CURRENT_BASE.
export const CURRENT_BASELINE = (column: 'id' | 'taken_at' | 'rev', a: string, now: string) =>
  `SELECT ${column} FROM snapshots WHERE incarnation = ${a}.incarnation AND timeline = ${a}.timeline AND kind = 'baseline'
     AND taken_at <= ${now}
   ORDER BY taken_at DESC, id DESC LIMIT 1`;

// How long a snapshot, a backup generation and an ended operation's pins last; a finished rewind's undo too.
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
// A day short of retention, and expiry runs in the daily job: a base chosen for a capture is at least a day from expiry,
// longer than any capture takes to name it.
const BASE_WINDOW_MS = RETENTION_MS - 24 * 60 * 60 * 1000;
// Over an accounts row aliased `a` and a time `now` (a bind): the id of the whole snapshot a new snapshot of the account
// is a delta against, or null, and the new one is whole. Lineage is the account's timeline, which changes exactly when
// the file stops descending from earlier snapshots: at signup (accounts.ts), a finished rewind (lifecycle.ts) and a
// disaster restore (backup/restore.ts). Time cannot stand in for it: a disaster restore writes no rewind row while the
// catalog keeps snapshots newer than the baseline it installed (and see CURRENT_BASELINE on the clock). A whole from
// before a schema upgrade is never a base: the delta is applied by position over the current schema's columns.
const CURRENT_BASE = (a: string, now: string) =>
  `SELECT id FROM snapshots WHERE incarnation = ${a}.incarnation AND base IS NULL AND timeline = ${a}.timeline
     AND schema_version = ${ACCOUNT_SCHEMA_VERSION} AND taken_at > ${now} - ${BASE_WINDOW_MS}
   ORDER BY taken_at DESC, id DESC LIMIT 1`;

const MAX_HANDLES = 256;
const IDLE_MS = 10 * 60 * 1000;
// node:sqlite error codes that mean the file itself is unreadable.
const CORRUPT_CODES = new Set([11, 26]);

export const accountPath = (dataDir: string, incarnation: string) => join(dataDir, 'accounts', `${incarnation}.sqlite`);

// Thrown inside a store call for a file the rules cannot be answered from; the registry turns it into { unavailable }.
export class StoreUnavailable extends Error {
  constructor(readonly why: 'missing' | 'newer-schema' | 'snapshot-missing' | 'snapshot-corrupt' | 'corrupt') {
    super(`account store unavailable: ${why}`);
  }
}

const random = () => randomBytes(6).toString('hex');

// The signup's first step: the file exists, with its schema and head, before the account's row does. A crash in
// between leaves a file with no row, which the hourly reconciliation removes after an hour.
function prepareAccountFile(dataDir: string, incarnation: string, timeline: string): void {
  const path = accountPath(dataDir, incarnation);
  makeDirs(join(dataDir, 'accounts'));
  if (existsSync(path)) throw new Error(`account file exists: ${incarnation}`);
  const db = openDatabase(path);
  try {
    transaction(db, () => {
      for (const statement of SCHEMA) db.exec(statement);
      db.prepare('INSERT INTO head (id, rev, bytes, timeline, schema_version) VALUES (1, 0, 0, ?, ?)').run(timeline, ACCOUNT_SCHEMA_VERSION);
    });
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
  fsyncPath(path);
  fsyncPath(join(dataDir, 'accounts'));
}

// Future schema upgrades run here, in one transaction, before the first read.
function openAccountFile(path: string): DatabaseSync {
  if (!existsSync(path)) throw new StoreUnavailable('missing');
  const db = openDatabase(path);
  let version: number;
  try {
    version = (db.prepare('SELECT schema_version FROM head WHERE id = 1').get() as { schema_version: number } | undefined)?.schema_version ?? NaN;
  } catch (error) {
    db.close();
    throw corruptOr(error);
  }
  if (version > ACCOUNT_SCHEMA_VERSION) {
    db.close();
    throw new StoreUnavailable('newer-schema');
  }
  if (Number.isNaN(version)) {
    db.close();
    throw new StoreUnavailable('corrupt');
  }
  return db;
}

function corruptOr(error: unknown): unknown {
  const code = (error as { errcode?: number }).errcode;
  return code !== undefined && CORRUPT_CODES.has(code) ? new StoreUnavailable('corrupt') : error;
}

// The snapshot a rewind to `at` lands on: the newest taken at or before it, and taken after the checkpoint of every
// rewind finished by then (ended_at, not the checkpoint's time: one that finished after `at` had not replaced anything
// yet), since one taken before such a rewind holds the state it replaced.
// No age cut here: an account unchanged for longer than retention has only an old baseline, and that baseline is its
// state at `at`. How far back a rewind may ask is lifecycle's request window; retention keeps the baseline that window
// needs (backup/snapshots.ts).
// A catalogued snapshot whose file is gone or altered is a storage failure, not "too early".
export async function snapshotFor(files: Bucket, service: Db, incarnation: string, at: number): Promise<{ id: string; takenAt: number } | null> {
  const row = await landing(service, incarnation, at);
  if (row === null) return null;
  await verifySnapshot(files, service, incarnation, row.id);
  return { id: row.id, takenAt: row.takenAt };
}

// snapshotFor's choice, unverified: for listing what a restore can land on (server/lifecycle restorePoints).
export const landing = (service: Db, incarnation: string, at: number) =>
  service
    .prepare(
      `SELECT id, taken_at AS takenAt, kind FROM snapshots WHERE incarnation = ?1 AND taken_at <= ?2
         AND taken_at > COALESCE((SELECT MAX(checkpoint_at) FROM restores WHERE incarnation = ?1 AND phase = 'done' AND ended_at <= ?2), -1)
       ORDER BY taken_at DESC LIMIT 1`,
    )
    .bind(incarnation, at)
    .first<{ id: string; takenAt: number; kind: SnapshotKind }>();

async function snapshotRow(service: Db, incarnation: string, id: string) {
  const row = await service
    .prepare('SELECT bytes, sha256, base, rev FROM snapshots WHERE id = ? AND incarnation = ?')
    .bind(id, incarnation)
    .first<{ bytes: number; sha256: string; base: string | null; rev: number }>();
  if (row === null) throw new StoreUnavailable('snapshot-missing');
  return row;
}

// The preview and target selection verify the same bytes as the materializer, including a delta's base, so an
// archive the install would refuse is refused before an operation is armed on it.
async function verifySnapshot(files: Bucket, service: Db, incarnation: string, id: string): Promise<void> {
  const row = await snapshotRow(service, incarnation, id);
  await readSnapshot(files, incarnation, id, row);
  if (row.base !== null) await verifySnapshot(files, service, incarnation, row.base);
}

async function readSnapshot(files: Bucket, incarnation: string, id: string, row: { bytes: number; sha256: string }, target?: string) {
  const body = await files.get(snapshotKey(incarnation, id));
  if (body === null) throw new StoreUnavailable('snapshot-missing');
  const hash = createHash('sha256');
  let bytes = 0;
  const digest = new Transform({ transform(chunk: Buffer, _, next) { bytes += chunk.length; hash.update(chunk); next(null, chunk); } });
  try {
    if (target) await pipeline(body, digest, createGunzip(), createWriteStream(target));
    else await pipeline(body, digest, new Writable({ write(_, _encoding, next) { next(); } }));
  } catch (error) {
    if (target) rmSync(target, { force: true });
    if ((error as NodeJS.ErrnoException).code?.startsWith('Z_')) throw new StoreUnavailable('snapshot-corrupt');
    throw error;
  }
  if (bytes !== row.bytes || hash.digest('hex') !== row.sha256) {
    if (target) rmSync(target, { force: true });
    throw new StoreUnavailable('snapshot-corrupt');
  }
}

// The one reader of a snapshot's format; every caller gets a plain whole account file.
export async function materializeSnapshot(files: Bucket, service: Db, incarnation: string, id: string, target: string): Promise<void> {
  const snapshot = await snapshotRow(service, incarnation, id);
  const { base, rev } = snapshot;
  await readSnapshot(files, incarnation, base ?? id, base === null ? snapshot : await snapshotRow(service, incarnation, base), target);
  if (base === null) return;
  const delta = `${target}.delta`;
  try {
    await readSnapshot(files, incarnation, id, snapshot, delta);
    const db = new DatabaseSync(target);
    try {
      db.prepare('ATTACH DATABASE ? AS delta').run(delta);
      try {
        transaction(db, () => {
          db.exec(`INSERT OR REPLACE INTO objects (id, kind, parent_id, rev, body, deleted_at) SELECT id, kind, parent_id, rev, body, deleted_at FROM delta.objects;
            DELETE FROM kv; INSERT INTO kv SELECT * FROM delta.kv;
            DELETE FROM head; INSERT INTO head SELECT * FROM delta.head;`);
        });
      } finally {
        db.exec('DETACH DATABASE delta');
      }
    } finally {
      db.close();
    }
  } finally {
    rmSync(delta, { force: true });
  }
  const check = new DatabaseSync(target, { readOnly: true });
  try {
    if ((check.prepare('SELECT rev FROM head').get() as { rev: number } | undefined)?.rev !== rev) throw new StoreUnavailable('snapshot-corrupt');
  } finally {
    check.close();
  }
}

// Exported for tests that wrap a StoreDb; production code reaches a file only through the registry.
export class AccountDb implements StoreDb {
  private handle: DatabaseSync | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly incarnation: string,
    private readonly service: Db,
    private readonly clock: () => number,
    private readonly files: Bucket,
  ) {}

  private db(): DatabaseSync {
    return (this.handle ??= openAccountFile(accountPath(this.dataDir, this.incarnation)));
  }

  exec<T>(sql: string, ...binds: SqlValue[]): T[] {
    try {
      return this.db().prepare(sql).all(...binds).map((row) => ({ ...row })) as T[];
    } catch (error) {
      throw corruptOr(error);
    }
  }

  transaction<T>(fn: () => T): T {
    return transaction(this.db(), fn);
  }

  async wipe() {
    this.close();
    const path = accountPath(this.dataDir, this.incarnation);
    for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
  }

  readonly kv = {
    get: (key: string): unknown => this.exec<{ value: string }>('SELECT value FROM kv WHERE key = ?', key)[0]?.value,
    put: (key: string, value: string) => {
      this.exec('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value);
    },
    delete: (key: string) => this.exec<{ n: number }>('DELETE FROM kv WHERE key = ? RETURNING 1 AS n', key).length > 0,
  };

  size() {
    return this.exec<{ size: number }>('SELECT page_count * page_size AS size FROM pragma_page_count(), pragma_page_size()')[0]!.size;
  }

  // Capture runs on the account queue: eligibility, takenAt, the timeline, the base and rev must describe the same file,
  // before any later checkpoint or replacement. Publishing the private copy needs no live handle or account queue.
  async captureSnapshot(kind: SnapshotKind, operation: number | null): Promise<() => Promise<string>> {
    const takenAt = this.clock();
    const id = `${takenAt}-${random()}`;
    const dir = join(this.dataDir, 'accounts');
    makeDirs(dir);
    const plain = join(dir, `.tmp-${id}.sqlite`);
    const gz = join(dir, `.tmp-${id}.sqlite.gz`);
    const { timeline, base, baseRev } = (await this.service
      .prepare(`SELECT a.timeline, s.id AS base, s.rev AS baseRev FROM accounts a LEFT JOIN snapshots s ON s.id = (${CURRENT_BASE('a', '?2')}) WHERE a.incarnation = ?1`)
      .bind(this.incarnation, takenAt)
      .first<{ timeline: string; base: string | null; baseRev: number | null }>())!;
    let rev: number;
    try {
      if (base === null) {
        rev = this.exec<{ rev: number }>('SELECT rev FROM head')[0]!.rev;
        await backup(this.db(), plain);
      } else {
        const db = this.db();
        db.prepare('ATTACH DATABASE ? AS delta').run(plain);
        try {
          rev = this.transaction(() => {
            // Exact only while account-store.ts writes every objects row with a rev above the previous head.rev and
            // never hard-deletes one (a purge empties body under a new rev): then `rev > base.rev` is every change
            // since the base. A hard delete there needs a purge log this delta carries first.
            db.exec(`CREATE TABLE delta.head AS SELECT * FROM main.head;
              CREATE TABLE delta.kv AS SELECT * FROM main.kv;
              CREATE TABLE delta.objects AS SELECT * FROM main.objects WHERE rev > ${baseRev};`);
            return this.exec<{ rev: number }>('SELECT rev FROM delta.head')[0]!.rev;
          });
        } finally {
          db.exec('DETACH DATABASE delta');
        }
      }
    } catch (error) {
      rmSync(plain, { force: true });
      throw error;
    }
    return async () => {
      try {
        const { bytes, expanded, sha256 } = await archiveSnapshot(plain, gz);
        await this.files.putFile(snapshotKey(this.incarnation, id), gz);
        // The row follows the durable artifact. A crash before publication leaves a .tmp-* or uncatalogued gzip
        // for reconciliation; the capture's time and revision never advance to publication time.
        await this.service
          .prepare('INSERT INTO snapshots (id, incarnation, kind, operation, taken_at, rev, bytes, expanded, sha256, base, timeline, schema_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(id, this.incarnation, kind, operation, takenAt, rev, bytes, expanded, sha256, base, timeline, ACCOUNT_SCHEMA_VERSION)
          .run();
      } finally {
        rmSync(plain, { force: true });
        rmSync(gz, { force: true });
      }
      return id;
    };
  }

  readonly snapshots = {
    // A checkpoint stays on the queue through publication: a rewind must have its durable undo before advancing.
    take: async (operation: number): Promise<string> => (await this.captureSnapshot('checkpoint', operation))(),
    forTime: async (at: number): Promise<string | null> => (await snapshotFor(this.files, this.service, this.incarnation, at))?.id ?? null,
    verify: async (id: string) => {
      await verifySnapshot(this.files, this.service, this.incarnation, id);
    },
  };

  close() {
    if (!this.handle) return;
    try {
      this.handle.exec('PRAGMA wal_checkpoint(PASSIVE)');
    } catch {
      // A corrupt or already-wiped file has nothing to checkpoint.
    }
    this.handle.close();
    this.handle = null;
  }
}

export type StoreStub = { [M in keyof StoreRules]: StoreRules[M] } & { restart(incarnation: string): Promise<never> };

export type Stores = {
  // A fresh stub per call chain: one got before a restart fails every later call.
  getByName(incarnation: string): StoreStub;
  // File claims and the object writes or sweep they protect share this account's queue. The callback must use the
  // supplied rules, never a queued stub, and must not wait on another call of the same account.
  withStore<T>(incarnation: string, work: (store: StoreRules) => Promise<T>): Promise<T | Unavailable>;
  prepare(incarnation: string, timeline: string): Promise<void>;
  // A session the snapshot had to open is closed after capture, so archiving holds no otherwise idle handles. refused: the
  // account takes no baseline now (TAKES_BASELINE). unchanged: its file still holds the revision its current baseline
  // (CURRENT_BASELINE) recorded, so that baseline is its state and no copy is taken.
  snapshot(incarnation: string): Promise<{ taken: string } | { refused: true } | { unchanged: true }>;
  evictIdle(now?: number): void;
  close(): void;
  // A separate read of the account's file, for tests and the operator's tools: never through a session.
  inspect(incarnation: string): { exec<T>(sql: string, ...binds: SqlValue[]): T[]; tables(): string[] };
};

type Session = { db: AccountDb; rules: StoreRules };
type Entry = { generation: number; queue: Promise<unknown>; pending: number; session: Session | null; lastUsed: number };

export function accountRegistry(dataDir: string, service: Db, reads: StoreReads, clock: () => number, files: Bucket): Stores {
  const entries = new Map<string, Entry>();
  const entry = (incarnation: string) => {
    const held = entries.get(incarnation);
    if (held) return held;
    const made: Entry = { generation: 0, queue: Promise.resolve(), pending: 0, session: null, lastUsed: clock() };
    entries.set(incarnation, made);
    return made;
  };

  const enqueue = <T>(held: Entry, work: () => Promise<T>): Promise<T> => {
    held.pending++;
    const run = held.queue.then(work, work).finally(() => {
      held.pending--;
      held.lastUsed = clock();
    });
    held.queue = run.catch(() => {});
    return run;
  };

  const closeSession = (held: Entry) => {
    held.session?.db.close();
    held.session = null;
  };

  const bound = () => {
    const open = [...entries.values()].filter((held) => held.session);
    if (open.length < MAX_HANDLES) return;
    const idle = open.filter((held) => held.pending === 0).sort((a, b) => a.lastUsed - b.lastUsed)[0];
    if (idle) closeSession(idle);
  };

  const session = async (incarnation: string, held: Entry): Promise<Session> => {
    if (held.session) return held.session;
    await installArmed(dataDir, service, incarnation, files);
    bound();
    const db = new AccountDb(dataDir, incarnation, service, clock, files);
    held.session = { db, rules: new StoreRules(db, reads, (work) => work()) };
    return held.session;
  };

  const getByName = (incarnation: string): StoreStub => {
    const held = entry(incarnation);
    const generation = held.generation;
    const live = () => {
      if (held.generation !== generation) throw new Error('This stub ended with a restart; get a fresh one.');
    };
    const call =
      (method: keyof StoreRules) =>
      (...args: unknown[]) =>
        enqueue(held, async () => {
          live();
          try {
            // Inside the try: opening the session installs an armed target, which can find its snapshot unusable.
            const { rules } = await session(incarnation, held);
            return await (rules[method] as (...args: unknown[]) => Promise<unknown>).apply(rules, args);
          } catch (error) {
            if (error instanceof StoreUnavailable) return { unavailable: true } satisfies Unavailable;
            throw error;
          }
        });
    const restart = () =>
      enqueue(held, async (): Promise<never> => {
        live();
        closeSession(held);
        held.generation++;
        throw new Error('The store restarted.');
      });
    return new Proxy({} as StoreStub, {
      get: (_, method) => {
        if (method === 'restart') return restart;
        if (typeof method !== 'string' || !Object.hasOwn(StoreRules.prototype, method) || method === 'constructor') return undefined;
        return call(method as keyof StoreRules);
      },
    });
  };

  return {
    getByName,
    withStore: (incarnation, work) => enqueue(entry(incarnation), async () => {
      try {
        return await work((await session(incarnation, entry(incarnation))).rules);
      } catch (error) {
        if (error instanceof StoreUnavailable) return { unavailable: true } as const;
        throw error;
      }
    }),
    prepare: async (incarnation, timeline) => prepareAccountFile(dataDir, incarnation, timeline),
    snapshot: async (incarnation) => {
      const held = entry(incarnation);
      const captured = await enqueue(held, async () => {
        // Read here, not from the session's lifecycle: that is cached, and says restoring until the store next
        // reloads after an operation is done. The checkpoint uses this queue too, so none comes between this check and the copy.
        const row = await service
          .prepare(`SELECT ${TAKES_BASELINE('a')} AS free, (${CURRENT_BASELINE('rev', 'a', '?2')}) AS rev FROM accounts a WHERE incarnation = ?1`)
          .bind(incarnation, clock())
          .first<{ free: number; rev: number | null }>();
        if (!row?.free) return { refused: true as const };
        const opened = !held.session;
        const { db } = await session(incarnation, held);
        try {
          if (db.exec<{ rev: number }>('SELECT rev FROM head')[0]!.rev === row.rev) return { unchanged: true as const };
          return await db.captureSnapshot('baseline', null);
        } finally {
          if (opened) closeSession(held);
        }
      });
      // The caller still waits for publication, so fresh() and the capture gate never name an unfinished baseline.
      return typeof captured === 'function' ? { taken: await captured() } : captured;
    },
    evictIdle: (now = clock()) => {
      for (const held of entries.values()) if (held.session && held.pending === 0 && now - held.lastUsed >= IDLE_MS) closeSession(held);
    },
    close: () => {
      for (const held of entries.values()) closeSession(held);
    },
    inspect: (incarnation) => {
      const path = accountPath(dataDir, incarnation);
      const read = <T>(fn: (db: DatabaseSync) => T, absent: T): T => {
        if (!existsSync(path)) return absent;
        const db = new DatabaseSync(path, { readOnly: true });
        try {
          return fn(db);
        } finally {
          db.close();
        }
      };
      return {
        exec: <T>(sql: string, ...binds: SqlValue[]) => read((db) => db.prepare(sql).all(...binds).map((row) => ({ ...row })) as T[], []),
        tables: () => read((db) => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(({ name }) => name), []),
      };
    },
  };
}

// An armed restore is installed when the account's store next starts: the snapshot is decompressed beside the live
// file, checked, marked with the snapshot it came from and the operation installing it, checkpointed into one file,
// verified, and renamed over the live file after its WAL and shm are gone, so the live file is always either the old
// one intact or the new one whole. The mark names the operation too: a later rewind to the same snapshot is a new
// install over a file that has changed since.
async function installArmed(dataDir: string, service: Db, incarnation: string, files: Bucket): Promise<void> {
  const armed = await service
    .prepare(
      `SELECT r.id, r.target FROM restores r JOIN accounts a ON a.incarnation = r.incarnation AND a.operation = r.id
       WHERE a.incarnation = ? AND a.state = 'restoring' AND r.phase = 'armed' AND r.target IS NOT NULL`,
    )
    .bind(incarnation)
    .first<{ id: number; target: string }>();
  if (armed === null) return;
  const live = accountPath(dataDir, incarnation);
  if (existsSync(live)) {
    const current = new DatabaseSync(live, { readOnly: true });
    try {
      const head = current.prepare('SELECT installed_from, installed_op FROM head').get() as { installed_from: string | null; installed_op: number | null } | undefined;
      if (head?.installed_from === armed.target && head.installed_op === armed.id) return;
    } finally {
      current.close();
    }
  }
  await installSnapshot(dataDir, service, incarnation, armed.target, armed.id, files);
}

// The install itself, also run by a disaster restore (backup/restore.ts) for an operation already past it. No session
// may hold the live file.
export async function installSnapshot(dataDir: string, service: Db, incarnation: string, armed: string, operation: number, files: Bucket): Promise<void> {
  const live = accountPath(dataDir, incarnation);
  const staged = join(dataDir, 'accounts', `${incarnation}.install-${random()}.sqlite`);
  try {
    await materializeSnapshot(files, service, incarnation, armed, staged);
    const db = new DatabaseSync(staged);
    try {
      const [check] = db.prepare('PRAGMA quick_check').all() as { quick_check: string }[];
      if (check?.quick_check !== 'ok') throw new StoreUnavailable('corrupt');
      const version = (db.prepare('SELECT schema_version FROM head WHERE id = 1').get() as { schema_version: number }).schema_version;
      if (version > ACCOUNT_SCHEMA_VERSION) throw new StoreUnavailable('newer-schema');
      db.prepare('UPDATE head SET installed_from = ?, installed_op = ? WHERE id = 1').run(armed, operation);
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally {
      db.close();
    }
    const verify = new DatabaseSync(staged, { readOnly: true });
    try {
      const head = verify.prepare('SELECT installed_from, installed_op FROM head').get() as { installed_from: string | null; installed_op: number | null };
      const tables = (verify.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(({ name }) => name);
      if (head.installed_from !== armed || head.installed_op !== operation || !tables.includes('objects') || !tables.includes('kv')) throw new StoreUnavailable('corrupt');
    } finally {
      verify.close();
    }
    fsyncPath(staged);
    for (const suffix of ['-wal', '-shm']) rmSync(live + suffix, { force: true });
    renameSync(staged, live);
    fsyncPath(join(dataDir, 'accounts'));
  } finally {
    for (const suffix of ['', '-wal', '-shm']) rmSync(staged + suffix, { force: true });
  }
}
