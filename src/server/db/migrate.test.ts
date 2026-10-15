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

  it('adds shares that go with their account, and keeps every report in one inbox that also takes signed-out share reports', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db, dir(Object.fromEntries(['0001_baseline.sql', '0002_models_dev.sql'].map((name) => [name, readFileSync(`migrations/${name}`, 'utf8')]))));
    db.exec(`INSERT INTO accounts (id, username, login_hash, created_at, incarnation, timeline) VALUES ('a', 'jin', 'h', 1, 'inc', 't');
      INSERT INTO reports (id, account_id, username, text, created_at) VALUES (7, 'a', 'jin', '안 열려요', 2)`);
    expect(migrate(db, 'migrations').applied).toContain('0003_shares.sql');
    expect(db.prepare('SELECT id, account_id, username, text, share FROM reports').all()).toEqual([{ id: 7, account_id: 'a', username: 'jin', text: '안 열려요', share: null }]);
    db.exec(`INSERT INTO shares (id, incarnation, created_at) VALUES ('s', 'inc', 3);
      INSERT INTO share_versions VALUES ('s', 1, 'm', 3);
      INSERT INTO share_files VALUES ('s', 1, 'f');
      INSERT INTO reports (text, created_at, share, share_version, link) VALUES ('신고', 4, 's', 1, 'https://hazelle.app/s/s#k')`);
    expect(() => db.exec(`INSERT INTO reports (text, created_at) VALUES ('누구?', 5)`)).toThrow(/CHECK/);
    db.exec(`DELETE FROM accounts WHERE id = 'a'`);
    expect(['shares', 'share_versions', 'share_files'].map((table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get())).toEqual([{ n: 0 }, { n: 0 }, { n: 0 }]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM reports').get()).toEqual({ n: 2 });
  });

  it('lets a restore have no report, keeping its rows and never reusing an id', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db, dir(Object.fromEntries(['0001_baseline.sql', '0002_models_dev.sql', '0003_shares.sql', '0004_picture_removals.sql'].map((name) => [name, readFileSync(`migrations/${name}`, 'utf8')]))));
    db.exec(`INSERT INTO accounts (id, username, login_hash, created_at, incarnation, timeline) VALUES ('a', 'jin', 'h', 1, 'inc', 't');
      INSERT INTO restores (id, incarnation, report_id, at, timeline, phase, created_at, updated_at) VALUES (4, 'inc', 7, 2, 't2', 'done', 3, 3);
      INSERT INTO restores (id, incarnation, report_id, at, timeline, phase, created_at, updated_at) VALUES (9, 'inc', 8, 2, 't3', 'done', 3, 3);
      DELETE FROM restores WHERE id = 9`);
    expect(migrate(db, 'migrations').applied).toContain('0005_self_restores.sql');
    expect(db.prepare('SELECT id, report_id, timeline FROM restores').all()).toEqual([{ id: 4, report_id: 7, timeline: 't2' }]);
    expect(db.prepare(`INSERT INTO restores (incarnation, at, timeline, phase, created_at, updated_at) VALUES ('inc', 2, 't4', 'begun', 5, 5) RETURNING id, report_id`).get()).toEqual({ id: 10, report_id: null });
    db.exec(`DELETE FROM accounts WHERE id = 'a'`);
    expect(db.prepare('SELECT COUNT(*) AS n FROM restores').get()).toEqual({ n: 0 });
  });

  it('adds durable snapshot removals without changing or discarding the snapshot catalog', () => {
    const db = new DatabaseSync(':memory:');
    const shipped = readdirSync('migrations').filter((name) => name.endsWith('.sql') && name < '0009');
    migrate(db, dir(Object.fromEntries(shipped.map((name) => [name, readFileSync(`migrations/${name}`, 'utf8')]))));
    db.exec("INSERT INTO snapshots (id, incarnation, kind, taken_at, rev, bytes, expanded, sha256) VALUES ('s', 'i', 'baseline', 1, 2, 3, 4, 'h')");
    expect(migrate(db, 'migrations').applied).toContain('0009_snapshot_removals.sql');
    expect(db.prepare('SELECT rev, bytes, expanded, sha256 FROM snapshots').all()).toEqual([{ rev: 2, bytes: 3, expanded: 4, sha256: 'h' }]);
    db.exec("INSERT INTO snapshot_removals VALUES ('snapshots/i/s.sqlite.gz', 7); DELETE FROM snapshots WHERE id = 's'");
    expect(db.prepare('SELECT * FROM snapshot_removals').all()).toEqual([{ key: 'snapshots/i/s.sqlite.gz', due_at: 7 }]);
    db.close();
  });

  it('dates every held file’s claim at its upload, and keeps released pictures only as long as their account', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    const shipped = readdirSync('migrations').filter((name) => name.endsWith('.sql') && name < '0010');
    migrate(db, dir(Object.fromEntries(shipped.map((name) => [name, readFileSync(join('migrations', name), 'utf8')]))));
    db.exec(`INSERT INTO accounts (id, username, login_hash, created_at, incarnation, timeline) VALUES ('u', 'jin', 'h', 1, 'i', 't');
      INSERT INTO account_files (incarnation, id, size, stored, created_at) VALUES ('i', 'f', 3, 1, 42)`);
    expect(migrate(db, 'migrations').applied).toContain('0010_file_removals.sql');
    expect(db.prepare('SELECT claimed_at FROM account_files').get()).toEqual({ claimed_at: 42 });
    db.exec("INSERT INTO file_removals (incarnation, id, size, created_at, released_at, due_at) VALUES ('i', 'g', 1, 1, 2, 3); DELETE FROM account_files; DELETE FROM accounts");
    expect(db.prepare('SELECT COUNT(*) AS n FROM file_removals').get()).toEqual({ n: 0 });
  });

  it('removes account-wide login locks from existing accounts without changing credentials or sessions', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    const shipped = readdirSync('migrations').filter((name) => name.endsWith('.sql') && name < '0011');
    migrate(db, dir(Object.fromEntries(shipped.map((name) => [name, readFileSync(join('migrations', name), 'utf8')]))));
    db.exec(`INSERT INTO accounts (id, username, login_hash, created_at, incarnation, timeline, failed_logins, locked_until)
      VALUES ('u', 'jin', 'password', 1, 'i', 't', 12, 9999999999999);
      INSERT INTO vaults (account_id, password_wrap, recovery_wrap, recovery_hash, created_at, updated_at)
      VALUES ('u', 'pw', 'rw', 'recovery', 1, 1);
      INSERT INTO sessions (token_hash, account_id, expires_at) VALUES ('token', 'u', 9999999999999)`);
    const { failed_logins: failures, locked_until: lock, ...account } = db.prepare('SELECT * FROM accounts').get()!;
    expect([failures, lock]).toEqual([12, 9999999999999]);
    const vault = db.prepare('SELECT * FROM vaults').get();
    const session = db.prepare('SELECT * FROM sessions').get();
    expect(migrate(db, 'migrations').applied).toEqual(['0011_visitor_login_limits.sql']);
    expect(db.prepare('SELECT * FROM accounts').get()).toEqual(account);
    expect(db.prepare('SELECT * FROM vaults').get()).toEqual(vault);
    expect(db.prepare('SELECT * FROM sessions').get()).toEqual(session);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
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
