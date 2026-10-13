import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_SCHEMA_VERSION } from '../db/account-db';
import type { Services } from '../http';
import { beginRestore, runRestore } from '../lifecycle';
import { proof, sessionCookie, signupBody, testApp } from '../testing';
import { COPIED, expireGenerations, generationsDir, listGenerations, MANIFEST, POOL, readManifest, type Manifest } from './generation';
import { DAY_MS, dayStart } from './snapshots';

// crossDevice: every link answers EXDEV, as when files/ and backup/ are separate filesystems. cutPoolCopy: a copy into
// the pool writes part of the picture and throws, as a capture cut off mid-copy leaves it.
const fault = vi.hoisted(() => ({ crossDevice: false, cutPoolCopy: false }));
vi.mock('node:fs/promises', async (original) => {
  const real = await original<typeof import('node:fs/promises')>();
  return {
    ...real,
    link: (...args: Parameters<typeof real.link>) => (fault.crossDevice ? Promise.reject(Object.assign(new Error('cross-device link'), { code: 'EXDEV' })) : real.link(...args)),
    copyFile: async (...args: Parameters<typeof real.copyFile>) => {
      if (!fault.cutPoolCopy || !String(args[1]).includes('/backup/files/')) return real.copyFile(...args);
      await real.writeFile(String(args[1]), 'part');
      throw new Error('cut off mid-copy');
    },
  };
});

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.dispose());
beforeEach(async () => {
  Object.assign(fault, { crossDevice: false, cutPoolCopy: false });
  await t.reset();
  await t.env.db.prepare('UPDATE service SET signup_cap = 100').run();
});

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const picture = (text: string) => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;

async function signedUp(username: string) {
  const body = signupBody(username);
  const cookie = sessionCookie(await t.post('signup', body));
  const incarnation = (await t.env.db.prepare('SELECT incarnation FROM accounts WHERE id = ?').bind(body.accountId).first<string>('incarnation'))!;
  return { id: body.accountId, cookie, incarnation, body };
}
async function uploaded(cookie: string, text: string) {
  const bytes = picture(text);
  expect((await t.put(`files/${sha(bytes)}`, bytes, cookie)).status).toBe(204);
  return sha(bytes);
}
const generation = async (id: string) => (await readManifest(join(generationsDir(t.dir), id)))!;
const newest = async () => generation((await listGenerations(t.dir)).toSorted((a, b) => b.capturedAt - a.capturedAt)[0]!.id);

function serviceOf(manifest: Manifest) {
  const path = join(t.dir, 'scratch.sqlite');
  rmSync(path, { force: true });
  const bytes = readFileSync(join(generationsDir(t.dir), manifest.id, manifest.service.path));
  expect(sha(bytes)).toBe(manifest.service.sha256);
  writeFileSync(path, gunzipSync(bytes));
  return new DatabaseSync(path, { readOnly: true });
}

// env whose service snapshot waits until released: the gate is held from before it until after the links.
function pausedAtSnapshot() {
  let reach = () => {};
  let release = () => {};
  const reached = new Promise<void>((resolve) => (reach = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));
  const env: Services = {
    ...t.env,
    db: {
      ...t.env.db,
      snapshot: async (path) => { reach(); await released; await t.env.db.snapshot(path); },
    },
  };
  return { env, reached, release };
}

describe('a backup generation', () => {
  it('holds lifecycle steps out while it captures, lets password changes and uploads through, and names only what is durable', async () => {
    await signedUp('operator');
    const keeper = await signedUp('keeper');
    const leaver = await signedUp('leaver');
    const rewinder = await signedUp('rewinder');
    const kept = await uploaded(keeper.cookie, 'kept picture');
    const left = await uploaded(leaver.cookie, 'leaver picture');
    t.clock.now = () => Date.now() - 60 * 60_000;
    await t.stores.snapshot(rewinder.incarnation, 'baseline');
    t.clock.now = () => Date.now();
    expect((await t.post('reports', { text: 'restore' }, rewinder.cookie)).status).toBe(204);
    const report = (await t.env.db.prepare('SELECT id FROM reports').first<number>('id'))!;

    const paused = pausedAtSnapshot();
    const now = Date.now();
    const capturing = t.env.backups.daily(paused.env, now);
    await paused.reached;
    const settled: string[] = [];
    const watch = <T>(name: string, work: Promise<T>) => work.then((value) => (settled.push(name), value));
    const signup = watch('signup', t.post('signup', signupBody('latecomer')));
    const leaving = watch('deletion', t.delete('account', { method: 'password', proof: leaver.body.passwordProof }, leaver.cookie));
    const rewinding = watch('rewind', beginRestore(t.env, rewinder.id, report, { at: now - 30 * 60_000 }));
    const changed = await t.put('vault/password', { method: 'password', proof: proof('password'), passwordProof: proof('new password'), passwordWrap: 'bmV3IHdyYXA=' }, keeper.cookie);
    expect(changed.status).toBe(204);
    const late = await uploaded(keeper.cookie, 'uploaded during capture');
    expect(settled).toEqual([]);
    paused.release();
    expect((await capturing).generation).toEqual({ outcome: 'ok', error: null });
    expect((await signup).status).toBe(201);
    expect((await leaving).status).toBe(204);
    expect(await runRestore(t.env, ((await rewinding) as { begun: number }).begun)).toMatchObject({ phase: 'done' });

    const manifest = await newest();
    const service = serviceOf(manifest);
    try {
      expect(service.prepare("SELECT password_wrap FROM vaults v JOIN accounts a ON a.id = v.account_id WHERE a.username = 'keeper'").get()).toEqual({ password_wrap: 'bmV3IHdyYXA=' });
      expect(service.prepare('SELECT username FROM accounts ORDER BY username').all().map(({ username }) => username)).toEqual(['keeper', 'leaver', 'operator', 'rewinder']);
      expect(service.prepare('SELECT COUNT(*) AS n FROM restores').get()).toEqual({ n: 0 });
    } finally {
      service.close();
    }
    expect(manifest.accounts.every(({ baseline }) => baseline !== null)).toBe(true);
    expect(manifest.pictures.toSorted()).toEqual([kept, left, late].toSorted());
    for (const id of manifest.pictures) expect(sha(readFileSync(join(generationsDir(t.dir), POOL, id)))).toBe(id);
    for (const snapshot of manifest.snapshots) expect(sha(readFileSync(join(generationsDir(t.dir), manifest.id, snapshot.path)))).toBe(snapshot.sha256);
    for (const artifact of [manifest.service, ...manifest.snapshots]) {
      expect(artifact.expanded).toBe(gunzipSync(readFileSync(join(generationsDir(t.dir), manifest.id, artifact.path))).length);
    }
    const pictureBytes = Object.fromEntries(manifest.accounts.map(({ incarnation, pictureBytes }) => [incarnation, pictureBytes]));
    expect(pictureBytes).toMatchObject({ [keeper.incarnation]: 'kept picture'.length + 'uploaded during capture'.length, [leaver.incarnation]: 'leaver picture'.length, [rewinder.incarnation]: 0 });
    expect(readFileSync(join(generationsDir(t.dir), manifest.id, MANIFEST), 'utf8')).toMatch(/"pictures":\[[^\]]*\],"migrations":\[[^\]]*\]\}$/);
    await t.settle();
    expect(existsSync(join(t.dir, 'files', leaver.incarnation))).toBe(false);
    const { gateMs } = (await t.env.db.prepare("SELECT gate_ms AS gateMs FROM backup_runs WHERE kind = 'generation'").first<{ gateMs: number }>())!;
    expect(gateMs).toBeGreaterThan(0);
  });

  it('leaves the previous generation whole when one is cut off, and removes the cut-off one after a day', async () => {
    await signedUp('operator');
    const lost = await signedUp('lost');
    const lostPicture = await uploaded(lost.cookie, 'its bytes will vanish');
    const first = Date.now() - 2 * DAY_MS;
    expect((await t.daily(first)).generation).toEqual({ outcome: 'ok', error: null });
    const whole = await newest();
    // The next night a stored picture's bytes are gone, so the generation stops before its manifest.
    rmSync(join(t.dir, 'files', lost.incarnation, lostPicture));
    expect((await t.daily(first + DAY_MS)).generation).toMatchObject({ outcome: 'failed' });
    const cut = (await listGenerations(t.dir)).find(({ capturedAt }) => capturedAt === first + DAY_MS)!;
    expect(existsSync(join(generationsDir(t.dir), cut.id, MANIFEST))).toBe(false);
    expect(await generation(whole.id)).toEqual(whole);
    for (const snapshot of whole.snapshots) expect(sha(readFileSync(join(generationsDir(t.dir), whole.id, snapshot.path)))).toBe(snapshot.sha256);
    expect(await expireGenerations(t.dir, first + DAY_MS + DAY_MS / 2)).toEqual({ removed: 0, pictures: 0 });
    expect(await expireGenerations(t.dir, first + 2 * DAY_MS)).toEqual({ removed: 1, pictures: 0 });
    expect((await listGenerations(t.dir)).map(({ id }) => id)).toEqual([whole.id]);
  });

  it('puts a picture copied across filesystems into the pool only whole: a copy cut off leaves nothing under its name, and the next generation copies it again', async () => {
    const operator = await signedUp('operator');
    const id = await uploaded(operator.cookie, 'copied, not linked');
    Object.assign(fault, { crossDevice: true, cutPoolCopy: true });
    const first = Date.now() - DAY_MS;
    expect((await t.daily(first)).generation).toMatchObject({ outcome: 'failed' });
    expect(readdirSync(join(generationsDir(t.dir), POOL)).filter((name) => !name.startsWith('.tmp-'))).toEqual([]);
    fault.cutPoolCopy = false;
    expect((await t.daily(first + DAY_MS / 2)).generation).toEqual({ outcome: 'ok', error: null });
    expect((await newest()).pictures).toEqual([id]);
    expect(sha(readFileSync(join(generationsDir(t.dir), POOL, id)))).toBe(id);
  });

  it('names a baseline as of today for an account whose rewind was cut off before its checkpoint: a new one if it changed, its old one if not', async () => {
    await signedUp('operator');
    const now = Date.now();
    const paused = async (username: string, operation: number, change: boolean) => {
      const account = await signedUp(username);
      t.clock.now = () => now - 2 * DAY_MS;
      const old = ((await t.stores.snapshot(account.incarnation, 'baseline')) as { taken: string }).taken;
      if (change) expect((await t.batch([{ id: crypto.randomUUID(), kind: 'chat', parent: null, body: 'since', baseRev: null }], account.cookie)).status).toBe(200);
      await t.env.db.prepare("INSERT INTO restores (id, incarnation, report_id, at, timeline, phase, created_at, updated_at) VALUES (?, ?, 1, 1, 't', 'fenced', 1, 1)").bind(operation, account.incarnation).run();
      await t.lifecycle(account.id, `state = 'restoring', operation = ${operation}`);
      return { incarnation: account.incarnation, old };
    };
    const changed = await paused('changed', 8, true);
    const unchanged = await paused('unchanged', 9, false);
    expect((await t.daily(now)).generation).toEqual({ outcome: 'ok', error: null });
    const { accounts } = await newest();
    const named = (incarnation: string) => accounts.find((account) => account.incarnation === incarnation)!.baseline;
    expect(named(changed.incarnation)).toMatch(new RegExp(`^${now}-`));
    expect(named(unchanged.incarnation)).toBe(unchanged.old);
  });

  it('names the baseline of the account’s timeline, not one of an older timeline stamped later by a clock put back', async () => {
    const account = await signedUp('rewound');
    const day = dayStart(Date.now()) - DAY_MS;
    t.clock.now = () => day + 60 * 60_000;
    const current = ((await t.stores.snapshot(account.incarnation, 'baseline')) as { taken: string }).taken;
    await t.env.db
      .prepare("INSERT INTO snapshots (id, incarnation, kind, taken_at, rev, bytes, expanded, sha256, timeline, schema_version) VALUES ('old-timeline', ?1, 'baseline', ?2, 1, 1, 1, 'x', 'old', ?3)")
      .bind(account.incarnation, day + 2 * 60 * 60_000, ACCOUNT_SCHEMA_VERSION)
      .run();
    expect((await t.daily(day + 3 * 60 * 60_000)).generation).toEqual({ outcome: 'ok', error: null });
    expect((await newest()).accounts.find(({ incarnation }) => incarnation === account.incarnation)!.baseline).toBe(current);
  });

  it('names the base of a delta baseline and of a pinned delta beside them, and sizes a delta with its base', async () => {
    await signedUp('operator');
    const now = Date.now();
    const baselineAt = async (account: Awaited<ReturnType<typeof signedUp>>, at: number) => {
      expect((await t.batch([{ id: crypto.randomUUID(), kind: 'chat', parent: null, body: String(at), baseRev: null }], account.cookie)).status).toBe(200);
      t.clock.now = () => at;
      return ((await t.stores.snapshot(account.incarnation, 'baseline')) as { taken: string }).taken;
    };
    const base = async (id: string) => t.env.db.prepare('SELECT base FROM snapshots WHERE id = ?').bind(id).first<string | null>('base');
    const delta = await signedUp('delta');
    const deltaBase = await baselineAt(delta, now - 2 * 60 * 60_000);
    const deltaBaseline = await baselineAt(delta, now - 60 * 60_000);
    expect(await base(deltaBaseline)).toBe(deltaBase);
    // Past the base window, so its current baseline is whole and names neither the pinned delta nor its base.
    const pinner = await signedUp('pinner');
    const pinnedBase = await baselineAt(pinner, now - 6.5 * DAY_MS);
    const pinned = await baselineAt(pinner, now - 6.4 * DAY_MS);
    const current = await baselineAt(pinner, now - 60 * 60_000);
    expect([await base(pinned), await base(current)]).toEqual([pinnedBase, null]);
    await t.env.db
      .prepare("INSERT INTO restores (incarnation, report_id, at, timeline, target, phase, verified, created_at, updated_at, ended_at) VALUES (?1, 1, 1, 't', ?2, 'cancelled', 1, ?3, ?3, ?3)")
      .bind(pinner.incarnation, pinned, now - 60 * 60_000)
      .run();

    expect((await t.daily(now)).generation).toEqual({ outcome: 'ok', error: null });
    const manifest = await newest();
    const named = (incarnation: string) => manifest.snapshots.filter((snapshot) => snapshot.incarnation === incarnation).map(({ id }) => id);
    expect(named(delta.incarnation)).toEqual([deltaBase, deltaBaseline].toSorted());
    expect(named(pinner.incarnation)).toEqual([pinnedBase, pinned, current].toSorted());
    for (const snapshot of manifest.snapshots) expect(sha(readFileSync(join(generationsDir(t.dir), manifest.id, snapshot.path)))).toBe(snapshot.sha256);
    const entry = (id: string) => manifest.snapshots.find((snapshot) => snapshot.id === id)!;
    expect(entry(pinned).materialized).toBe(entry(pinnedBase).expanded + entry(pinned).expanded);
    expect(entry(current).materialized).toBe(entry(current).expanded);
  });

  it('keeps only the newest generation of each day, besides the two newest overall and any not yet copied off-site', async () => {
    const hour = DAY_MS / 24;
    const today = dayStart(Date.now());
    const made = (at: number, copied: boolean) => {
      const root = join(generationsDir(t.dir), `${at}-${at.toString(16).slice(-8)}`);
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, MANIFEST), JSON.stringify({ pictures: [] }));
      if (copied) writeFileSync(join(root, COPIED), 'copied');
    };
    for (const at of [1, 2, 3, 4].map((h) => today + h * hour)) made(at, true);
    for (const at of [1, 2, 3].map((h) => today - DAY_MS + h * hour)) made(at, true);
    made(today + hour / 2, false);
    expect(await expireGenerations(t.dir, today + 5 * hour)).toEqual({ removed: 4, pictures: 0 });
    expect((await listGenerations(t.dir)).map(({ capturedAt }) => capturedAt).toSorted()).toEqual(
      [today - DAY_MS + 3 * hour, today + hour / 2, today + 3 * hour, today + 4 * hour],
    );
  });

  it('collects a generation at 7 days and with it only the pictures no kept generation names', async () => {
    await signedUp('operator');
    const keeper = await signedUp('keeper');
    const leaver = await signedUp('leaver');
    const shared = await uploaded(keeper.cookie, 'both hold this');
    expect(await uploaded(leaver.cookie, 'both hold this')).toBe(shared);
    const kept = await uploaded(keeper.cookie, 'kept');
    const gone = await uploaded(leaver.cookie, 'gone with the leaver');
    const first = Date.now() - 8 * DAY_MS;
    await t.daily(first);
    expect((await newest()).pictures.toSorted()).toEqual([shared, kept, gone].toSorted());
    expect((await t.delete('account', { method: 'password', proof: leaver.body.passwordProof }, leaver.cookie)).status).toBe(204);
    await t.settle();
    await t.daily(first + DAY_MS);
    expect((await newest()).pictures.toSorted()).toEqual([shared, kept].toSorted());
    expect(readdirSync(join(generationsDir(t.dir), POOL)).toSorted()).toEqual([shared, kept, gone].toSorted());
    await t.daily(first + 7 * DAY_MS + DAY_MS / 2);
    expect((await listGenerations(t.dir)).map(({ capturedAt }) => capturedAt).toSorted()).toEqual([first + DAY_MS, first + 7 * DAY_MS + DAY_MS / 2]);
    expect(readdirSync(join(generationsDir(t.dir), POOL)).toSorted()).toEqual([shared, kept].toSorted());
  });
});
