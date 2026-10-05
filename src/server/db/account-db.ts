import { createHash, randomBytes } from 'node:crypto';
import { closeSync, createReadStream, createWriteStream, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { StoreRules, type SqlValue, type StoreDb, type StoreReads, type Unavailable } from '../account-store';
import { openDatabase, type Db } from './service-db';

// One account's database file, accounts/<incarnation>.sqlite, behind StoreRules (account-store.ts), and the registry
// that owns every open file: one serial queue per incarnation, a replaceable session, the install of an armed restore
// when a session starts, and the bounds of §3 (handles, idle eviction). The layout is docs/research/docker-port-plan.md §4.

// Bumped with every change to SCHEMA; a file carrying a newer number is refused, never downgraded.
export const ACCOUNT_SCHEMA_VERSION = 1;
const SCHEMA = [
  'CREATE TABLE head (id INTEGER PRIMARY KEY CHECK (id = 1), rev INTEGER NOT NULL, bytes INTEGER NOT NULL, timeline TEXT NOT NULL, schema_version INTEGER NOT NULL, installed_from TEXT)',
  'CREATE TABLE objects (id TEXT PRIMARY KEY, kind TEXT NOT NULL, parent_id TEXT, rev INTEGER NOT NULL, body TEXT, deleted_at INTEGER)',
  // The global cursor stays in revision order, including omitted bodies.
  'CREATE INDEX objects_rev ON objects (rev, kind, parent_id, id, deleted_at)',
  'CREATE INDEX objects_parent_rev ON objects (parent_id, rev)',
  'CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
];
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_HANDLES = 256;
const IDLE_MS = 10 * 60 * 1000;
// node:sqlite error codes that mean the file itself is unreadable.
const CORRUPT_CODES = new Set([11, 26]);

export const accountPath = (dataDir: string, incarnation: string) => join(dataDir, 'accounts', `${incarnation}.sqlite`);
const snapshotDir = (dataDir: string, incarnation: string) => join(dataDir, 'snapshots', incarnation);
const snapshotPath = (dataDir: string, incarnation: string, id: string) => join(snapshotDir(dataDir, incarnation), `${id}.sqlite.gz`);

// Thrown inside a store call for a file the rules cannot be answered from; the registry turns it into { unavailable }.
export class StoreUnavailable extends Error {
  constructor(readonly why: 'missing' | 'newer-schema' | 'snapshot-missing' | 'corrupt') {
    super(`account store unavailable: ${why}`);
  }
}

function fsyncPath(path: string) {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

const random = () => randomBytes(6).toString('hex');

// The signup's first step: the file exists, with its schema and head, before the account's row does. A crash in
// between leaves a file with no row, which the hourly reconciliation removes after an hour.
export function prepareAccountFile(dataDir: string, incarnation: string, timeline: string): void {
  const path = accountPath(dataDir, incarnation);
  mkdirSync(join(dataDir, 'accounts'), { recursive: true });
  if (existsSync(path)) throw new Error(`account file exists: ${incarnation}`);
  const db = openDatabase(path);
  try {
    db.exec('BEGIN');
    for (const statement of SCHEMA) db.exec(statement);
    db.prepare('INSERT INTO head (id, rev, bytes, timeline, schema_version) VALUES (1, 0, 0, ?, ?)').run(timeline, ACCOUNT_SCHEMA_VERSION);
    db.exec('COMMIT');
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
  fsyncPath(path);
  fsyncPath(join(dataDir, 'accounts'));
}

// Opens a file this process may read and write, refusing one from a newer build. Future schema upgrades run here, in
// one transaction, before the first read.
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

// Exported for tests that wrap a StoreDb; production code reaches a file only through the registry.
export class AccountDb implements StoreDb {
  private handle: DatabaseSync | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly incarnation: string,
    private readonly service: Db,
    private readonly clock: () => number,
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
    const db = this.db();
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
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

  readonly snapshots = {
    // The catalog row is written only after the artifact is durable, so a row never names bytes that are not there;
    // a crash before it leaves a .tmp-* file the reconciliation removes.
    take: async (kind: 'baseline' | 'checkpoint', operation: number | null): Promise<string> => {
      const takenAt = this.clock();
      const id = `${takenAt}-${random()}`;
      const dir = snapshotDir(this.dataDir, this.incarnation);
      mkdirSync(dir, { recursive: true });
      const plain = join(dir, `.tmp-${id}.sqlite`);
      const gz = join(dir, `.tmp-${id}.sqlite.gz`);
      // VACUUM INTO takes a literal path and runs outside any transaction; the registry's queue keeps writers out.
      this.db().exec(`VACUUM INTO '${plain.replaceAll("'", "''")}'`);
      try {
        const copy = new DatabaseSync(plain, { readOnly: true });
        try {
          const [check] = copy.prepare('PRAGMA quick_check').all() as { quick_check: string }[];
          if (check?.quick_check !== 'ok') throw new Error(`snapshot of ${this.incarnation} failed quick_check: ${check?.quick_check}`);
        } finally {
          copy.close();
        }
        const hash = createHash('sha256');
        let bytes = 0;
        await pipeline(createReadStream(plain), createGzip(), async function* (chunks) {
          for await (const chunk of chunks as AsyncIterable<Buffer>) {
            hash.update(chunk);
            bytes += chunk.length;
            yield chunk;
          }
        }, createWriteStream(gz));
        fsyncPath(gz);
        renameSync(gz, snapshotPath(this.dataDir, this.incarnation, id));
        fsyncPath(dir);
        await this.service
          .prepare('INSERT INTO snapshots (id, incarnation, kind, operation, taken_at, bytes, sha256) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(id, this.incarnation, kind, operation, takenAt, bytes, hash.digest('hex'))
          .run();
      } finally {
        rmSync(plain, { force: true });
        rmSync(gz, { force: true });
      }
      return id;
    },
    // A catalogued snapshot whose file is gone is a storage failure, not "too early".
    forTime: async (at: number): Promise<string | null> => {
      const row = await this.service
        .prepare('SELECT id FROM snapshots WHERE incarnation = ?1 AND taken_at <= ?2 AND taken_at > ?3 ORDER BY taken_at DESC LIMIT 1')
        .bind(this.incarnation, at, this.clock() - RETENTION_MS)
        .first<string>('id');
      if (row === null) return null;
      if (!existsSync(snapshotPath(this.dataDir, this.incarnation, row))) throw new StoreUnavailable('snapshot-missing');
      return row;
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
  prepare(incarnation: string, timeline: string): Promise<void>;
  snapshot(incarnation: string, kind: 'baseline'): Promise<string>;
  evictIdle(now?: number): void;
  close(): void;
  // A separate read of the account's file, for tests and the operator's tools: never through a session.
  inspect(incarnation: string): { exec<T>(sql: string, ...binds: SqlValue[]): T[]; tables(): string[] };
};

type Session = { db: AccountDb; rules: StoreRules };
type Entry = { generation: number; queue: Promise<unknown>; pending: number; session: Session | null; lastUsed: number };

export function accountRegistry(dataDir: string, service: Db, reads: StoreReads, clock: () => number): Stores {
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

  // The 257th open handle closes the least recently used session with nothing running or queued.
  const bound = () => {
    const open = [...entries.values()].filter((held) => held.session);
    if (open.length < MAX_HANDLES) return;
    const idle = open.filter((held) => held.pending === 0).sort((a, b) => a.lastUsed - b.lastUsed)[0];
    if (idle) closeSession(idle);
  };

  const session = async (incarnation: string, held: Entry): Promise<Session> => {
    if (held.session) return held.session;
    await installArmed(dataDir, service, incarnation);
    bound();
    const db = new AccountDb(dataDir, incarnation, service, clock);
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
          const { rules } = await session(incarnation, held);
          try {
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
    prepare: async (incarnation, timeline) => prepareAccountFile(dataDir, incarnation, timeline),
    snapshot: (incarnation, kind) =>
      enqueue(entry(incarnation), async () => {
        const { db } = await session(incarnation, entry(incarnation));
        return db.snapshots.take(kind, null);
      }),
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
// file, checked, marked with the snapshot it came from, checkpointed into one file, verified, and renamed over the
// live file after its WAL and shm are gone, so the live file is always either the old one intact or the new one whole.
async function installArmed(dataDir: string, service: Db, incarnation: string): Promise<void> {
  const armed = await service
    .prepare(
      `SELECT r.target FROM restores r JOIN accounts a ON a.incarnation = r.incarnation AND a.operation = r.id
       WHERE a.incarnation = ? AND a.state = 'restoring' AND r.phase = 'armed' AND r.target IS NOT NULL`,
    )
    .bind(incarnation)
    .first<string>('target');
  if (armed === null) return;
  const live = accountPath(dataDir, incarnation);
  if (existsSync(live)) {
    const current = new DatabaseSync(live, { readOnly: true });
    try {
      if ((current.prepare('SELECT installed_from FROM head').get() as { installed_from: string | null } | undefined)?.installed_from === armed) return;
    } finally {
      current.close();
    }
  }
  const source = snapshotPath(dataDir, incarnation, armed);
  if (!existsSync(source)) throw new StoreUnavailable('snapshot-missing');
  const staged = join(dataDir, 'accounts', `${incarnation}.install-${random()}.sqlite`);
  try {
    await pipeline(createReadStream(source), createGunzip(), createWriteStream(staged));
    const db = new DatabaseSync(staged);
    try {
      const [check] = db.prepare('PRAGMA quick_check').all() as { quick_check: string }[];
      if (check?.quick_check !== 'ok') throw new StoreUnavailable('corrupt');
      const version = (db.prepare('SELECT schema_version FROM head WHERE id = 1').get() as { schema_version: number }).schema_version;
      if (version > ACCOUNT_SCHEMA_VERSION) throw new StoreUnavailable('newer-schema');
      db.prepare('UPDATE head SET installed_from = ? WHERE id = 1').run(armed);
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally {
      db.close();
    }
    const verify = new DatabaseSync(staged, { readOnly: true });
    try {
      const head = verify.prepare('SELECT installed_from FROM head').get() as { installed_from: string | null };
      const tables = (verify.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(({ name }) => name);
      if (head.installed_from !== armed || !tables.includes('objects') || !tables.includes('kv')) throw new StoreUnavailable('corrupt');
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

// What prepareAccountFile's schema promises every reader; exported for the signup's one-off checks in tests.
export const ACCOUNT_TABLES = ['head', 'kv', 'objects'];

export function listAccountFiles(dataDir: string): string[] {
  try {
    return readdirSync(join(dataDir, 'accounts'));
  } catch {
    return [];
  }
}
