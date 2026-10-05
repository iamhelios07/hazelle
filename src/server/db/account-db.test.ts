import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { serviceReads, type Write } from '../account-store';
import { reconcile } from '../reconcile';
import { accountPath, accountRegistry, snapshotPath, type Stores } from './account-db';
import { serviceDb, type Db } from './service-db';

const INC = 'a'.repeat(32);
const A = '11111111-1111-4111-8111-111111111111';
const put = (id: string, body: string, baseRev: number | null = null): Write => ({ id, kind: 'chat', parent: null, body, baseRev });

let dir: string;
let raw: DatabaseSync;
let db: Db;
let stores: Stores;
let now: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hazelle-accounts-'));
  raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec(readFileSync('migrations/0001_baseline.sql', 'utf8'));
  db = serviceDb(raw);
  now = 1_000_000;
  stores = accountRegistry(dir, db, serviceReads(db), () => now);
});
afterEach(() => {
  stores.close();
  raw.close();
  rmSync(dir, { recursive: true, force: true });
});

async function signup(state = 'active', timeline = 't1') {
  await stores.prepare(INC, timeline);
  raw.prepare("INSERT INTO accounts (id, username, login_hash, created_at, incarnation, state, timeline) VALUES (?, 'jin', 'h', 1, ?, ?, ?)").run(A, INC, state, timeline);
}
const store = () => stores.getByName(INC);
const baseline = async () => (await stores.snapshot(INC, 'baseline'))!;
const write = (...writes: Write[]) => store().batch(INC, 't1', writes, null);
const bodies = async () => {
  const page = (await store().feed(INC, { timeline: 't1', since: 0, known: 0, until: null, bootstrap: false, metadata: false, excluded: [], parent: null })) as { changes: { id: string; body: string | null }[] };
  return page.changes.map(({ body }) => body);
};

describe('the account registry', () => {
  it('serves a prepared file, and a stub got before a restart fails every later call while a fresh one goes on', async () => {
    await signup();
    const old = store();
    expect(await old.batch(INC, 't1', [put(A, 'x')], null)).toEqual({ revs: [1], bytes: 1, timeline: 't1' });
    await expect(old.restart(INC)).rejects.toThrow(/restarted/);
    await expect(old.status(INC)).rejects.toThrow(/fresh one/);
    expect(await store().status(INC)).toEqual({ state: 'active', timeline: 't1', operation: null });
    expect(stores.inspect(INC).exec('SELECT rev, timeline, schema_version FROM head')).toEqual([{ rev: 1, timeline: 't1', schema_version: 1 }]);
  });

  it('keeps calls in order across a restart: work queued before it runs on the old session, a stub got before it ends', async () => {
    await signup();
    const first = store();
    const [a, b] = await Promise.all([first.batch(INC, 't1', [put(A, 'one')], null), first.restart(INC).catch((e: Error) => e.message)]);
    expect(a).toMatchObject({ revs: [1] });
    expect(b).toMatch(/restarted/);
    expect(await store().batch(INC, 't1', [put(A, 'two', 1)], null)).toMatchObject({ revs: [2] });
  });

  it('answers unavailable for an active account whose file is missing, corrupt or of a newer schema, and never makes an empty one', async () => {
    raw.prepare("INSERT INTO accounts (id, username, login_hash, created_at, incarnation, timeline) VALUES (?, 'jin', 'h', 1, ?, 't1')").run(A, INC);
    expect(await store().status(INC)).toEqual({ unavailable: true });
    expect(stores.inspect(INC).tables()).toEqual([]);
    mkdirSync(join(dir, 'accounts'), { recursive: true });
    writeFileSync(accountPath(dir, INC), 'not a database at all, but long enough to be read as one'.repeat(20));
    expect(await store().usage(INC)).toEqual({ unavailable: true });
    rmSync(accountPath(dir, INC));
    await stores.prepare(INC, 't1');
    const file = new DatabaseSync(accountPath(dir, INC));
    file.prepare('UPDATE head SET schema_version = 99').run();
    file.close();
    expect(await store().status(INC)).toEqual({ unavailable: true });
  });

  it('wipes a leaving account to no file, and a gone account answers gone without one', async () => {
    await signup('leaving');
    expect(await store().destroy(INC)).toEqual({ destroyed: true });
    expect(stores.inspect(INC).tables()).toEqual([]);
    raw.prepare('DELETE FROM accounts').run();
    await store().restart(INC).catch(() => {});
    expect(await store().status(INC)).toEqual({ state: 'gone', timeline: null, operation: null });
  });

  it('takes a snapshot whose catalog row names a durable gzip, finds it by time, and leaves no temp file', async () => {
    await signup();
    await write(put(A, 'old'));
    now = 2_000_000;
    const id = await baseline();
    const row = raw.prepare('SELECT kind, taken_at, bytes, sha256 FROM snapshots WHERE id = ?').get(id) as { kind: string; taken_at: number; bytes: number; sha256: string };
    expect(row).toMatchObject({ kind: 'baseline', taken_at: 2_000_000 });
    expect(row.bytes).toBeGreaterThan(0);
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(join(dir, 'snapshots', INC, `${id}.sqlite.gz`)).length).toBe(row.bytes);
    expect(stores.inspect(INC).exec("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE '.tmp%'")).toEqual([{ n: 0 }]);
    now = 3_000_000;
    await write(put(A, 'new', 1));
    expect(await store().status(INC)).toMatchObject({ state: 'active' });
  });

  it('installs the armed target when the store next starts: the file is the snapshot, marked with its id, and the mark is gone', async () => {
    await signup();
    await write(put(A, 'old'));
    now = 2_000_000;
    const target = await baseline();
    now = 3_000_000;
    await write(put(A, 'new', 1));
    raw.prepare("UPDATE accounts SET state = 'restoring', operation = 7 WHERE incarnation = ?").run(INC);
    raw.prepare("INSERT INTO restores (id, incarnation, report_id, at, timeline, target, phase, created_at, updated_at) VALUES (7, ?, 1, 2500000, 't2', ?, 'targeted', 1, 1)").run(INC, target);
    await store().restart(INC).catch(() => {});
    expect(await store().mark(INC, 7)).toEqual({ marked: true });
    expect(await store().marked(INC, 7)).toEqual({ marked: true, installedFrom: null, installedOp: null });
    raw.prepare("UPDATE restores SET phase = 'armed' WHERE id = 7").run();
    expect(await store().arm(INC, 7, target)).toEqual({ returned: target });
    await store().restart(INC).catch(() => {});
    expect(await store().marked(INC, 7)).toEqual({ marked: false, installedFrom: target, installedOp: 7 });
    raw.prepare("UPDATE accounts SET state = 'active', operation = NULL, timeline = 't2' WHERE incarnation = ?").run(INC);
    raw.prepare("UPDATE restores SET phase = 'done' WHERE id = 7").run();
    await store().restart(INC).catch(() => {});
    const page = (await store().feed(INC, { timeline: 't2', since: 0, known: 0, until: null, bootstrap: false, metadata: false, excluded: [], parent: null })) as { changes: { body: string | null }[] };
    expect(page.changes.map(({ body }) => body)).toEqual(['old']);
    expect(stores.inspect(INC).exec('SELECT installed_from, timeline FROM head')).toEqual([{ installed_from: target, timeline: 't2' }]);
    expect(await bodies().catch(() => 'stale')).toBe('stale');
  });

  it('excludes a snapshot taken before a finished rewind only for times after the rewind ended', async () => {
    await signup();
    await write(put(A, 'before the rewind'));
    now = 1_500_000;
    const before = await baseline();
    raw.prepare("INSERT INTO restores (incarnation, report_id, at, timeline, checkpoint_at, phase, created_at, updated_at, ended_at) VALUES (?, 1, 1, 't2', 1900000, 'done', 1, 1, 4000000)").run(INC);
    now = 5_000_000;
    expect(await stores.snapshotAt(INC, 3_000_000)).toEqual({ id: before, takenAt: 1_500_000 });
    expect(await stores.snapshotAt(INC, 4_500_000)).toBeNull();
  });

  it('answers unavailable, not too early, when a catalogued snapshot has lost its file or no longer matches its row, for a time and for an explicit target', async () => {
    await signup('restoring');
    raw.prepare('UPDATE accounts SET operation = 3').run();
    raw.prepare("INSERT INTO restores (id, incarnation, report_id, at, timeline, phase, created_at, updated_at) VALUES (3, ?, 1, 1, 't2', 'fenced', 1, 1)").run(INC);
    now = 1_500_000;
    const altered = await baseline();
    const path = snapshotPath(dir, INC, altered);
    const bytes = readFileSync(path);
    bytes[bytes.length - 1]! ^= 1;
    writeFileSync(path, bytes);
    now = 2_000_000;
    await expect(stores.snapshotAt(INC, 1_600_000)).rejects.toThrow(/snapshot-corrupt/);
    expect(await store().target(INC, 3, { at: 1_600_000 })).toEqual({ unavailable: true });
    expect(await store().target(INC, 3, { snapshot: altered })).toEqual({ unavailable: true });
    expect(await store().target(INC, 3, { at: 1_400_000 })).toEqual({ tooEarly: true });
    rmSync(path);
    expect(await store().target(INC, 3, { snapshot: altered })).toEqual({ unavailable: true });
  });

  it('installs a second rewind to the same snapshot over the edits made since the first', async () => {
    await signup();
    await write(put(A, 'old'));
    now = 2_000_000;
    const target = await baseline();
    const rewind = async (operation: number) => {
      raw.prepare("UPDATE accounts SET state = 'restoring', operation = ? WHERE incarnation = ?").run(operation, INC);
      raw.prepare("INSERT INTO restores (id, incarnation, report_id, at, timeline, target, phase, created_at, updated_at) VALUES (?, ?, 1, 2500000, 't1', ?, 'armed', 1, 1)").run(operation, INC, target);
      await store().restart(INC).catch(() => {});
      expect(await store().marked(INC, operation)).toEqual({ marked: false, installedFrom: target, installedOp: operation });
      raw.prepare("UPDATE accounts SET state = 'active', operation = NULL WHERE incarnation = ?").run(INC);
      raw.prepare("UPDATE restores SET phase = 'done' WHERE id = ?").run(operation);
      await store().restart(INC).catch(() => {});
    };
    await rewind(7);
    await write(put(A, 'edited after the first rewind', 1));
    await rewind(8);
    expect(await bodies()).toEqual(['old']);
  });

  it('publishes a snapshot only once its file is durable: a take whose catalog insert throws leaves an orphan the hourly sweep reclaims', async () => {
    await signup();
    await write(put(A, 'x'));
    const failing: Db = { ...db, prepare: (sql) => (sql.startsWith('INSERT INTO snapshots') ? ({ bind: () => ({ run: () => Promise.reject(new Error('insert failed')) }) } as never) : db.prepare(sql)) };
    const dying = accountRegistry(dir, failing, serviceReads(db), () => now);
    await expect(dying.snapshot(INC, 'baseline')).rejects.toThrow('insert failed');
    dying.close();
    const [orphan, ...more] = readdirSync(join(dir, 'snapshots', INC));
    expect(more).toEqual([]);
    expect(orphan).toMatch(/^[^.].*\.sqlite\.gz$/);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM snapshots').get()).toEqual({ n: 0 });
    expect((await reconcile(dir, db, Date.now())).removed).toEqual([]);
    const id = await baseline();
    expect((await reconcile(dir, db, Date.now() + 61 * 60_000)).removed).toEqual([`snapshots/${INC}/${orphan}`]);
    expect(existsSync(snapshotPath(dir, INC, id))).toBe(true);
  });

  it('installs whole across registry restarts: a staged file left beside the live one changes nothing and the next start installs, after the install the next start installs nothing', async () => {
    await signup();
    await write(put(A, 'old'));
    now = 2_000_000;
    const target = await baseline();
    await write(put(A, 'new', 1));
    raw.prepare("UPDATE accounts SET state = 'restoring', operation = 7 WHERE incarnation = ?").run(INC);
    raw.prepare("INSERT INTO restores (id, incarnation, report_id, at, timeline, target, phase, created_at, updated_at) VALUES (7, ?, 1, 2500000, 't2', ?, 'armed', 1, 1)").run(INC, target);
    const restart = () => {
      stores.close();
      stores = accountRegistry(dir, db, serviceReads(db), () => now);
    };
    // What a staging cut off before its rename leaves: a staged file beside the live one.
    writeFileSync(join(dir, 'accounts', `${INC}.install-dead.sqlite`), 'prepared, never renamed');
    restart();
    expect(stores.inspect(INC).exec('SELECT body FROM objects')).toEqual([{ body: 'new' }]);
    expect(stores.inspect(INC).exec('PRAGMA quick_check')).toEqual([{ quick_check: 'ok' }]);
    expect(await store().marked(INC, 7)).toEqual({ marked: false, installedFrom: target, installedOp: 7 });
    // Installed: the marker says so, and even with its snapshot gone nothing is installed again.
    restart();
    rmSync(snapshotPath(dir, INC, target));
    expect(await store().marked(INC, 7)).toEqual({ marked: false, installedFrom: target, installedOp: 7 });
    expect(stores.inspect(INC).exec('SELECT body FROM objects')).toEqual([{ body: 'old' }]);
    expect((await reconcile(dir, db, Date.now() + 61 * 60_000)).removed).toContain(`accounts/${INC}.install-dead.sqlite`);
  });

  it('takes a baseline before an operation’s checkpoint and after its end, read from the service, and refuses one between', async () => {
    await signup('restoring');
    raw.prepare('UPDATE accounts SET operation = 3').run();
    raw.prepare("INSERT INTO restores (id, incarnation, report_id, at, timeline, phase, created_at, updated_at) VALUES (3, ?, 1, 1, 't2', 'fenced', 1, 1)").run(INC);
    expect(await store().status(INC)).toMatchObject({ state: 'restoring' });
    expect(await stores.snapshot(INC, 'baseline')).toEqual(expect.any(String));
    raw.prepare("UPDATE restores SET phase = 'checkpointed' WHERE id = 3").run();
    expect(await stores.snapshot(INC, 'baseline')).toBeNull();
    raw.prepare("UPDATE restores SET phase = 'done' WHERE id = 3").run();
    raw.prepare("UPDATE accounts SET state = 'active', operation = NULL").run();
    expect(await stores.snapshot(INC, 'baseline')).toEqual(expect.any(String));
    expect(raw.prepare('SELECT COUNT(*) AS n FROM snapshots').get()).toEqual({ n: 2 });
  });

  it('closes an idle session after ten minutes and reopens it on the next call', async () => {
    await signup();
    await write(put(A, 'x'));
    stores.evictIdle(now + 10 * 60 * 1000);
    expect(await bodies()).toEqual(['x']);
  });
});
