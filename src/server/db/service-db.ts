import { DatabaseSync } from 'node:sqlite';

// The service database (accounts, sessions, vaults, restores, snapshots, ...) behind the statement surface the route
// modules were written against: prepare(sql).bind(...).first | all | run, and batch, one transaction. The SQL in the
// routes is the contract; this module makes node:sqlite answer it.

export type SqlValue = string | number | bigint | null | Uint8Array;
export type Row = Record<string, unknown>;
export type Result<T = Row> = { results: T[]; meta: { changes: number } };

export type Statement = {
  // A new statement each time: callers hold statements by identity.
  bind(...values: SqlValue[]): Statement;
  first<T = Row>(): Promise<T | null>;
  first<T = unknown>(column: string): Promise<T | null>;
  all<T = Row>(): Promise<Result<T>>;
  run(): Promise<Result<never>>;
};

export type Db = {
  prepare(sql: string): Statement;
  // One BEGIN IMMEDIATE … COMMIT, synchronous from the first statement to the commit: a statement's changes() is what
  // the statement before it did, which the signup, the reservation and the deletion chains gate on.
  batch<T = Row>(statements: Statement[]): Promise<Result<T>[]>;
};

const EXECUTE = Symbol('execute');
type Internal = Statement & { [EXECUTE]<T>(): Result<T> };

// Every file this process opens: WAL for readers beside the writer, FULL so an acknowledged commit survives power loss
// (the lifecycle orders a service write before an account's deletion and relies on it), foreign keys for the cascades
// the schema declares.
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = FULL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

export function serviceDb(db: DatabaseSync): Db {
  const statement = (sql: string, values: SqlValue[]): Internal => {
    const execute = <T>(): Result<T> => {
      const shape = placeholders(sql);
      if (shape.mixed) throw new Error(`A statement mixes ? and ?N placeholders: ${sql.trim().slice(0, 80)}`);
      // all() for every statement: a DML without RETURNING answers no rows, and changes() read right after it is
      // its count. A SELECT leaves changes() at the previous DML's count, which no caller reads.
      const results = db.prepare(sql).all(...values).map((row) => ({ ...row })) as T[];
      const changes = shape.reads ? 0 : (db.prepare('SELECT changes() AS n').get() as { n: number }).n;
      return { results, meta: { changes } };
    };
    return {
      [EXECUTE]: execute,
      bind: (...next) => statement(sql, next),
      first: async <T>(column?: string) => {
        const row = execute<Row>().results[0];
        if (row === undefined) return null;
        return (column === undefined ? row : (row[column] ?? null)) as T | null;
      },
      all: async <T>() => execute<T>(),
      run: async () => execute<never>(),
    };
  };
  return {
    prepare: (sql) => statement(sql, []),
    batch: async <T>(statements: Statement[]) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const out = statements.map((s) => (s as Internal)[EXECUTE]<T>());
        db.exec('COMMIT');
        return out;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

// The SQL with its string literals and comments blanked, so a ? or a keyword inside them is not read as syntax.
export function bare(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\/\*[\s\S]*?\*\//g, (match) => ' '.repeat(match.length));
}

// numbered: ?N placeholders; anonymous: bare ?. A statement uses one style. reads: it begins with SELECT, so it changes
// nothing; returning: a DML that answers rows.
export function placeholders(sql: string): { numbered: boolean; anonymous: boolean; mixed: boolean; reads: boolean; returning: boolean } {
  const text = bare(sql);
  const numbered = /\?\d/.test(text);
  const anonymous = /\?(?!\d)/.test(text);
  const reads = /^\s*(SELECT|WITH)\b/i.test(text);
  return { numbered, anonymous, mixed: numbered && anonymous, reads, returning: !reads && /\bRETURNING\b/i.test(text) };
}
