import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serviceReads, type Write } from '../account-store';
import { diskBucket } from '../files/disk-bucket';
import { reconcile } from '../reconcile';
import { accountPath, accountRegistry, materializeSnapshot, RETENTION_MS, snapshotPath, type Stores } from './account-db';
import { DAY_MS } from '../backup/snapshots';
import { migrate } from './migrate';
import { serviceDb, type Db } from './service-db';
import * as snapshots from './snapshot';

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
  migrate(raw, 'migrations');
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
const baseline = async () => ((await stores.snapshot(INC, 'baseline')) as { taken: string }).taken;
const write = (...writes: Write[]) => store().batch(INC, 't1', writes, null);
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
// A whole snapshot at rev 2, then two writes and a kv row, then a delta at rev 4.
async function baseAndDelta() {
  await signup();
  await write(put(A, 'a1'), put(B, 'b1'));
  now = 2_000_000;
  const base = await baseline();
  await write(put(A, 'a2', 1));
  await write(put(C, 'c1'));
  const file = new DatabaseSync(accountPath(dir, INC));
  file.prepare("INSERT INTO kv (key, value) VALUES ('mark', 'm')").run();
  file.close();
  now = 3_000_000;
  return { base, delta: await baseline() };
}
const opened = <T>(path: string, read: (db: DatabaseSync) => T): T => {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return read(db);
  } finally {
    db.close();
  }
};
const contents = (db: DatabaseSync) => ({
  head: db.prepare('SELECT * FROM head').all(),
  kv: db.prepare('SELECT * FROM kv ORDER BY key').all(),
  objects: db.prepare('SELECT id, kind, parent_id, rev, body, deleted_at FROM objects ORDER BY id').all(),
});
const bodies = async () => {
  const page = (await store().feed(INC, { timeline: 't1', since: 0, known: 0, until: null, bootstrap: false, metadata: false, excluded: [], parent: null, kind: null, count: false })) as { changes: { id: string; body: string | null }[] };
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

  it('releases the baseline queue after capture while publication preserves the captured revision and pre-checkpoint time', async () => {
    await signup();
    await write(put(A, 'captured'));
    let archiveStarted = () => {};
    let release = () => {};
    const archiving = new Promise<void>((resolve) => { archiveStarted = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const archive = snapshots.archiveSnapshot;
    const paused = vi.spyOn(snapshots, 'archiveSnapshot').mockImplementationOnce(async (plain, gzip) => {
      archiveStarted();
      await released;
      return archive(plain, gzip);
    });
    now = 2_000_000;
    const taking = baseline();
    try {
      await archiving;
      expect(raw.prepare('SELECT COUNT(*) AS n FROM snapshots').get()).toEqual({ n: 0 });
      now = 3_000_000;
      let written: unknown;
      const writing = write(put(A, 'after capture', 1)).then((answer) => { written = answer; });
      await expect.poll(() => written, { timeout: 1000 }).toMatchObject({ revs: [2] });
      await writing;
      expect(await bodies()).toEqual(['after capture']);
      raw.prepare("UPDATE accounts SET state = 'restoring', operation = 7").run();
      raw.prepare("INSERT INTO restores (id, incarnation, report_id, at, timeline, phase, created_at, updated_at) VALUES (7, ?, 1, 1, 't2', 'fenced', 1, 1)").run(INC);
      await store().restart(INC).catch(() => {});
      const checkpoint = await store().checkpoint(INC, 7);
      expect(checkpoint).toEqual({ checkpoint: expect.any(String) });
      // The lifecycle records checkpoint_at only after checkpoint() returns its durable undo.
      raw.prepare("UPDATE restores SET checkpoint_at = ?, ended_at = ?, phase = 'done' WHERE id = 7").run(now, now + 1);
      raw.prepare("UPDATE accounts SET state = 'active', operation = NULL").run();
      now = 4_000_000;
    } finally {
      release();
      await taking;
      paused.mockRestore();
    }
    const id = await taking;
    expect(raw.prepare('SELECT taken_at, rev FROM snapshots WHERE id = ?').get(id)).toEqual({ taken_at: 2_000_000, rev: 1 });
    const plain = join(dir, 'captured.sqlite');
    writeFileSync(plain, gunzipSync(readFileSync(snapshotPath(dir, INC, id))));
    const copy = new DatabaseSync(plain);
    try {
      expect(copy.prepare('SELECT rev FROM head').get()).toEqual({ rev: 1 });
      expect(copy.prepare('SELECT body FROM objects').all()).toEqual([{ body: 'captured' }]);
    } finally {
      copy.close();
    }
    expect(await stores.snapshotAt(INC, 2_500_000)).toEqual({ id, takenAt: 2_000_000 });
    expect(await stores.snapshotAt(INC, now)).toBeNull();
    expect(await stores.snapshot(INC, 'baseline')).toEqual({ taken: expect.any(String) });
    expect(readdirSync(join(dir, 'snapshots', INC)).some((name) => name.startsWith('.tmp-'))).toBe(false);
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
    const page = (await store().feed(INC, { timeline: 't2', since: 0, known: 0, until: null, bootstrap: false, metadata: false, excluded: [], parent: null, kind: null, count: false })) as { changes: { body: string | null }[] };
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
    expect((await reconcile(dir, db, diskBucket(dir), Date.now())).removed).toEqual([]);
    const id = await baseline();
    expect((await reconcile(dir, db, diskBucket(dir), Date.now() + 61 * 60_000)).removed).toEqual([`snapshots/${INC}/${orphan}`]);
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
    expect((await reconcile(dir, db, diskBucket(dir), Date.now() + 61 * 60_000)).removed).toContain(`accounts/${INC}.install-dead.sqlite`);
  });

  it('installs the armed target after SIGKILL during decompression leaves the live file and a real unfinished stage', async () => {
    await signup();
    await write(put(A, 'old'));
    now = 2_000_000;
    const target = await baseline();
    await write(put(A, 'new', 1));
    raw.prepare("UPDATE accounts SET state = 'restoring', operation = 7 WHERE incarnation = ?").run(INC);
    raw.prepare("INSERT INTO restores (id, incarnation, report_id, at, timeline, target, phase, created_at, updated_at) VALUES (7, ?, 1, 2500000, 't2', ?, 'armed', 1, 1)").run(INC, target);
    stores.close();
    await db.snapshot(join(dir, 'service.sqlite'));
    const killed = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const create = fs.createWriteStream;
      fs.createWriteStream = (...args) => {
        const stream = create(...args);
        if (String(args[0]).includes('.install-')) stream.once('open', () => process.kill(process.pid, 'SIGKILL'));
        return stream;
      };
      syncBuiltinESMExports();
      const { accountRegistry } = await import('./src/server/db/account-db.ts');
      const { openDatabase, serviceDb } = await import('./src/server/db/service-db.ts');
      const { serviceReads } = await import('./src/server/account-store.ts');
      const [dir, incarnation] = process.argv.slice(1);
      const service = serviceDb(openDatabase(dir + '/service.sqlite'));
      await accountRegistry(dir, service, serviceReads(service), Date.now).getByName(incarnation).marked(incarnation, 7);
    `, dir, INC], { env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' }, stdio: 'ignore', timeout: 10_000 });
    expect({ signal: killed.signal, error: killed.error, status: killed.status }).toEqual({ signal: 'SIGKILL', error: undefined, status: null });
    const [stage] = readdirSync(join(dir, 'accounts')).filter((name) => name.includes('.install-'));
    expect(stage).toBeDefined();
    expect(stores.inspect(INC).exec('SELECT body FROM objects')).toEqual([{ body: 'new' }]);
    expect(stores.inspect(INC).exec('PRAGMA quick_check')).toEqual([{ quick_check: 'ok' }]);
    stores = accountRegistry(dir, db, serviceReads(db), () => now);
    expect(await store().marked(INC, 7)).toEqual({ marked: false, installedFrom: target, installedOp: 7 });
    expect(stores.inspect(INC).exec('SELECT body FROM objects')).toEqual([{ body: 'old' }]);
    expect((await reconcile(dir, db, diskBucket(dir), Date.now() + 61 * 60_000)).removed).toContain(`accounts/${stage}`);
  });

  it('takes a baseline before an operation’s checkpoint and after its end, read from the service, and refuses one between', async () => {
    await signup('restoring');
    raw.prepare('UPDATE accounts SET operation = 3').run();
    raw.prepare("INSERT INTO restores (id, incarnation, report_id, at, timeline, phase, created_at, updated_at) VALUES (3, ?, 1, 1, 't2', 'fenced', 1, 1)").run(INC);
    expect(await store().status(INC)).toMatchObject({ state: 'restoring' });
    expect(await stores.snapshot(INC, 'baseline')).toEqual({ taken: expect.any(String) });
    raw.prepare("UPDATE restores SET phase = 'checkpointed' WHERE id = 3").run();
    expect(await stores.snapshot(INC, 'baseline')).toEqual({ refused: true });
    now = 2_000_000;
    raw.prepare("UPDATE restores SET phase = 'done', ended_at = ? WHERE id = 3").run(now);
    raw.prepare("UPDATE accounts SET state = 'active', operation = NULL").run();
    expect(await stores.snapshot(INC, 'baseline')).toEqual({ taken: expect.any(String) });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM snapshots').get()).toEqual({ n: 2 });
  });

  it('takes a delta that holds the head, the kv table and exactly the objects above its base’s rev', async () => {
    const { base, delta } = await baseAndDelta();
    expect(raw.prepare('SELECT id, base, rev FROM snapshots ORDER BY taken_at').all()).toEqual([
      { id: base, base: null, rev: 2 },
      { id: delta, base, rev: 4 },
    ]);
    expect(readdirSync(join(dir, 'snapshots', INC)).filter((name) => name.startsWith('.tmp-'))).toEqual([]);
    const plain = join(dir, 'delta.sqlite');
    writeFileSync(plain, gunzipSync(readFileSync(snapshotPath(dir, INC, delta))));
    opened(plain, (file) => {
      expect(file.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()).toEqual([{ name: 'head' }, { name: 'kv' }, { name: 'objects' }]);
      expect(file.prepare('SELECT rev FROM head').all()).toEqual([{ rev: 4 }]);
      expect(file.prepare('SELECT key, value FROM kv').all()).toEqual([{ key: 'mark', value: 'm' }]);
      expect(file.prepare('SELECT id, rev, body FROM objects ORDER BY rev').all()).toEqual([{ id: A, rev: 3, body: 'a2' }, { id: C, rev: 4, body: 'c1' }]);
    });
  });

  it('materializes a delta on its base into the same rows as the file it was taken of', async () => {
    const { delta } = await baseAndDelta();
    stores.close();
    const target = join(dir, 'materialized.sqlite');
    await materializeSnapshot(dir, db, INC, delta, target);
    expect(opened(target, contents)).toEqual(opened(accountPath(dir, INC), contents));
    expect(existsSync(`${target}.delta`)).toBe(false);
  });

  it('takes a whole snapshot first, a delta next, and a whole one again after a finished rewind and once the base is a day short of RETENTION_MS old', async () => {
    await signup();
    const take = async (at: number, body: string) => {
      now = at;
      await write(put(crypto.randomUUID(), body));
      const id = await baseline();
      return (raw.prepare('SELECT base FROM snapshots WHERE id = ?').get(id) as { base: string | null }).base === null ? 'whole' : 'delta';
    };
    expect(await take(2_000_000, 'first')).toBe('whole');
    expect(await take(3_000_000, 'next')).toBe('delta');
    raw.prepare("INSERT INTO restores (incarnation, report_id, at, timeline, checkpoint_at, phase, created_at, updated_at, ended_at) VALUES (?, 1, 1, 't1', 3500000, 'done', 1, 1, 4000000)").run(INC);
    expect(await take(5_000_000, 'after the rewind')).toBe('whole');
    expect(await take(5_000_000 + RETENTION_MS - DAY_MS - 1, 'within the base’s window')).toBe('delta');
    expect(await take(5_000_000 + RETENTION_MS - DAY_MS, 'the base aged out of the window, a day before it expires')).toBe('whole');
  });

  it('answers unavailable for a delta whose base file is altered or gone', async () => {
    const { base } = await baseAndDelta();
    const path = snapshotPath(dir, INC, base);
    const bytes = readFileSync(path);
    bytes[bytes.length - 1]! ^= 1;
    writeFileSync(path, bytes);
    await expect(stores.snapshotAt(INC, 3_000_000)).rejects.toThrow(/snapshot-corrupt/);
    rmSync(path);
    await expect(stores.snapshotAt(INC, 3_000_000)).rejects.toThrow(/snapshot-missing/);
  });

  it('installs a rewind to a delta as its materialized file', async () => {
    const { delta } = await baseAndDelta();
    await write(put(B, 'b2', 2));
    raw.prepare("UPDATE accounts SET state = 'restoring', operation = 7 WHERE incarnation = ?").run(INC);
    raw.prepare("INSERT INTO restores (id, incarnation, report_id, at, timeline, target, phase, created_at, updated_at) VALUES (7, ?, 1, 3000000, 't2', ?, 'armed', 1, 1)").run(INC, delta);
    await store().restart(INC).catch(() => {});
    expect(await store().marked(INC, 7)).toEqual({ marked: false, installedFrom: delta, installedOp: 7 });
    expect(stores.inspect(INC).exec('SELECT rev FROM head')).toEqual([{ rev: 4 }]);
    expect(stores.inspect(INC).exec('SELECT body FROM objects ORDER BY id')).toEqual([{ body: 'a2' }, { body: 'b1' }, { body: 'c1' }]);
  });

  it('keeps every hard delete of objects out of the store', () => {
    for (const source of ['src/server/account-store.ts', 'src/server/db/account-db.ts']) {
      expect(/delete\s+from\s+objects/i.test(readFileSync(source, 'utf8')), `${source}: a hard delete of objects breaks delta snapshots (docs/research/incremental-snapshots-plan.md); add a purge log the delta carries before deleting rows`).toBe(false);
    }
  });

  it('closes an idle session after ten minutes and reopens it on the next call', async () => {
    await signup();
    await write(put(A, 'x'));
    stores.evictIdle(now + 10 * 60 * 1000);
    expect(await bodies()).toEqual(['x']);
  });
});
