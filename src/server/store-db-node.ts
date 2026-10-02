/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { StoreRules, type SqlValue, type StoreDb, type StoreReads } from './account-store';

// StoreDb over node:sqlite, for tests. It proves the store's algorithm only: SQL logic, refusals, caps, paging,
// lifecycle checks and restore steps over a bookmark log kept here. It proves nothing about workerd's SQL limits,
// RPC serialization, output gates, real restarts, real bookmarks or deleteAll().
const REFUSED = /^\s*(BEGIN|SAVEPOINT|PRAGMA)\b/i;

type Snapshot = { at: number; schema: { type: string; name: string; sql: string }[]; rows: Map<string, Record<string, SqlValue>[]> };

export class NodeStoreDb implements StoreDb {
  private readonly db = new DatabaseSync(':memory:');
  // Kept outside the database, as Cloudflare keeps bookmarks: a wipe leaves it, and a rewind is to one of its points.
  private readonly log: Snapshot[] = [];
  private pending: Snapshot | null = null;
  private open = false;

  // now: the clock the log is stamped with, so a test can ask for a bookmark at a time it chose.
  constructor(private readonly now: () => number) {
    this.record();
  }

  exec<T>(sql: string, ...binds: SqlValue[]): T[] {
    if (REFUSED.test(sql)) throw new Error(`workerd refuses ${sql.trim().split(/\s/)[0]!.toUpperCase()} in exec; use transaction().`);
    return this.autocommit(() => this.db.prepare(sql).all(...binds) as T[]);
  }

  transaction<T>(fn: () => T): T {
    const before = this.changes();
    this.db.exec('BEGIN');
    this.open = true;
    try {
      const result = fn();
      this.db.exec('COMMIT');
      if (this.changes() !== before) this.record();
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.open = false;
    }
  }

  async wipe() {
    this.drop();
    this.record();
  }

  readonly kv = {
    get: (key: string): unknown => (this.tables().includes('_kv') ? this.db.prepare('SELECT value FROM _kv WHERE key = ?').get(key)?.value : undefined),
    put: (key: string, value: string) => {
      this.autocommit(() => this.kvTable().prepare('INSERT INTO _kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value));
    },
    delete: (key: string) => this.autocommit(() => this.kvTable().prepare('DELETE FROM _kv WHERE key = ?').run(key).changes > 0),
  };

  size() {
    return this.db.prepare('SELECT page_count * page_size AS size FROM pragma_page_count(), pragma_page_size()').get()!.size as number;
  }

  readonly bookmarks = {
    current: async () => String(this.log.length - 1),
    forTime: async (at: number) => {
      const index = this.log.findLastIndex((point) => point.at <= at);
      return index === -1 ? null : String(index);
    },
    restoreOnNextSession: async (bookmark: string) => {
      this.pending = this.log[Number(bookmark)]!;
      return String(this.log.length - 1);
    },
  };

  // The object starting again: a restore asked for applies now, as onNextSessionRestoreBookmark's does.
  restart() {
    if (!this.pending) return;
    const { schema, rows } = this.pending;
    this.pending = null;
    this.drop();
    for (const { type, sql } of schema) if (type === 'table') this.db.exec(sql);
    for (const [table, held] of rows) {
      for (const row of held) {
        const columns = Object.keys(row);
        this.db.prepare(`INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...Object.values(row));
      }
    }
    for (const { type, sql } of schema) if (type === 'index') this.db.exec(sql);
    this.record();
  }

  tables() {
    return (this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(({ name }) => name);
  }

  private autocommit<T>(fn: () => T): T {
    const before = this.changes();
    const result = fn();
    if (!this.open && this.changes() !== before) this.record();
    return result;
  }

  private kvTable() {
    this.db.exec('CREATE TABLE IF NOT EXISTS _kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    return this.db;
  }

  private changes() {
    return this.db.prepare('SELECT total_changes() AS changes').get()!.changes as number;
  }

  private drop() {
    for (const name of this.tables()) this.db.exec(`DROP TABLE "${name}"`);
  }

  private record() {
    const schema = this.db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid").all() as Snapshot['schema'];
    const rows = new Map(schema.filter(({ type }) => type === 'table').map(({ name }) => [name, this.db.prepare(`SELECT * FROM "${name}"`).all() as Record<string, SqlValue>[]]));
    this.log.push({ at: this.now(), schema, rows });
  }
}

export type StoreStub = { [M in keyof StoreRules]: StoreRules[M] } & { restart(incarnation: string): Promise<never> };

// STORES in process: one NodeStoreDb per name, run without blockConcurrencyWhile. restart() applies a pending restore
// and throws, as ctx.abort() does; a stub got before it throws on every later call, so a caller must get a fresh one.
export function nodeStores(reads: StoreReads, now: () => number) {
  const stores = new Map<string, { db: NodeStoreDb; rules: StoreRules; session: number }>();
  const held = (name: string) => {
    const store = stores.get(name);
    if (store) return store;
    const db = new NodeStoreDb(now);
    return stores.set(name, { db, rules: new StoreRules(db, reads, (work) => work()), session: 0 }).get(name)!;
  };
  return {
    getByName(name: string): StoreStub {
      const store = held(name);
      const session = store.session;
      const live = () => {
        if (store.session !== session) throw new Error('This stub ended with a restart; get a fresh one.');
        return store.rules;
      };
      const restart = async () => {
        live();
        store.db.restart();
        store.rules = new StoreRules(store.db, reads, (work) => work());
        store.session++;
        throw new Error('The store restarted.');
      };
      // Only the store's methods: a stub is not a thenable, so awaiting one is not a call.
      return new Proxy({} as StoreStub, {
        get: (_, method) => {
          if (method === 'restart') return restart;
          if (typeof method !== 'string' || !(method in StoreRules.prototype)) return undefined;
          return (...args: unknown[]) => (live()[method as keyof StoreRules] as (...args: unknown[]) => unknown).apply(live(), args);
        },
      });
    },
    db: (name: string) => held(name).db,
  };
}
