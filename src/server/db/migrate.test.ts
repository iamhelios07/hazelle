import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from './migrate';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const dir = (files: Record<string, string>) => {
  const path = mkdtempSync(join(tmpdir(), 'hazelle-migrations-'));
  dirs.push(path);
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(path, name), sql);
  return path;
};
const ledger = (db: DatabaseSync) => (db.prepare('SELECT name FROM migrations ORDER BY rowid').all() as { name: string }[]).map(({ name }) => name);
const tables = (db: DatabaseSync) => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'migrations' ORDER BY name").all() as { name: string }[]).map(({ name }) => name);

describe('the migration runner', () => {
  it('applies the shipped baseline to an empty database, and a restart applies nothing more', () => {
    const db = new DatabaseSync(':memory:');
    expect(migrate(db, 'migrations').applied).toEqual(readdirSync('migrations').filter((n) => n.endsWith('.sql')).sort());
    expect(migrate(db, 'migrations').applied).toEqual([]);
    expect(tables(db)).toContain('installation');
    expect(db.prepare('SELECT signup_cap, account_bytes_cap, account_file_bytes_cap FROM service').get()).toEqual({ signup_cap: 1, account_bytes_cap: 300000000, account_file_bytes_cap: 3000000000 });
  });

  it('moves stored prices to the models.dev list and asks for the list again', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, dir({ '0001_baseline.sql': readFileSync('migrations/0001_baseline.sql', 'utf8') }));
    db.exec(`INSERT INTO prices VALUES ('google', 'gemini-2.5-flash', 0.3, 2.5, NULL, NULL, '[]'); UPDATE price_fetch SET fetched_at = 5, tried_at = 5`);
    expect(migrate(db, 'migrations').applied).toContain('0002_models_dev.sql');
    expect(tables(db)).not.toContain('prices');
    expect(db.prepare('SELECT COUNT(*) AS n FROM models_dev').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT fetched_at, tried_at FROM models_dev_fetch').get()).toEqual({ fetched_at: null, tried_at: null });
  });

  it('upgrades a populated database with the files it lacks, each whole or not at all', () => {
    const db = new DatabaseSync(':memory:');
    const first = dir({ '0001_a.sql': 'CREATE TABLE a (x);' });
    migrate(db, first);
    db.exec("INSERT INTO a VALUES (1)");
    const second = dir({ '0001_a.sql': 'CREATE TABLE a (x);', '0002_b.sql': 'CREATE TABLE b (y); INSERT INTO b SELECT x FROM a;', '0003_bad.sql': 'CREATE TABLE c (z); INSERT INTO nowhere VALUES (1);' });
    expect(() => migrate(db, second)).toThrow(/0003_bad.sql failed/);
    expect(ledger(db)).toEqual(['0001_a.sql', '0002_b.sql']);
    expect(tables(db)).toEqual(['a', 'b']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM b').get()).toEqual({ n: 1 });
    writeFileSync(join(second, '0003_bad.sql'), 'CREATE TABLE c (z);');
    expect(migrate(db, second).applied).toEqual(['0003_bad.sql']);
  });

  it('refuses an applied file that changed, a ledger this build does not ship, a reordered ledger and a missing directory', () => {
    const db = new DatabaseSync(':memory:');
    const files = { '0001_a.sql': 'CREATE TABLE a (x);', '0002_b.sql': 'CREATE TABLE b (y);' };
    migrate(db, dir(files));
    expect(() => migrate(db, dir({ ...files, '0002_b.sql': 'CREATE TABLE b (y, z);' }))).toThrow(/0002_b.sql changed/);
    expect(() => migrate(db, dir({ '0001_a.sql': files['0001_a.sql'] }))).toThrow(/applied 0002_b.sql at position 2/);
    expect(() => migrate(db, dir({ '0001_b.sql': files['0002_b.sql'], '0002_a.sql': files['0001_a.sql'] }))).toThrow(/applied 0001_a.sql at position 1/);
    expect(() => migrate(db, join(tmpdir(), 'hazelle-nowhere'))).toThrow(/cannot read/);
    expect(() => migrate(db, dir({}))).toThrow(/no .sql files/);
    expect(readFileSync(join(dir(files), '0001_a.sql'), 'utf8')).toBe(files['0001_a.sql']);
  });
});
