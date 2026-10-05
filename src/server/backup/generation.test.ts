import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Statement } from '../db/service-db';
import type { Services } from '../http';
import { beginRestore, runRestore } from '../lifecycle';
import { proof, sessionCookie, signupBody, testApp } from '../testing';
import { expireGenerations, generationsDir, listGenerations, MANIFEST, POOL, readManifest, type Manifest } from './generation';
import { DAY_MS } from './snapshots';

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

// The service snapshot of a generation, opened from its gzip.
function serviceOf(manifest: Manifest) {
  const path = join(t.dir, 'scratch.sqlite');
  rmSync(path, { force: true });
  const bytes = readFileSync(join(generationsDir(t.dir), manifest.id, manifest.service.path));
  expect(sha(bytes)).toBe(manifest.service.sha256);
  writeFileSync(path, gunzipSync(bytes));
  return new DatabaseSync(path, { readOnly: true });
}

// env whose service snapshot waits until released: the gate is held from before it until after the links.
function pausedAtVacuum() {
  let reach = () => {};
  let release = () => {};
  const reached = new Promise<void>((resolve) => (reach = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));
  const env: Services = {
    ...t.env,
    db: {
      ...t.env.db,
      prepare: (sql) => {
        const real = t.env.db.prepare(sql);
        if (!sql.startsWith('VACUUM INTO')) return real;
        return { ...real, run: async () => (reach(), await released, real.run()) } as Statement;
      },
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

    const paused = pausedAtVacuum();
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
    // The next night a stored picture's bytes are gone, so the generation stops before its manifest, as one killed
    // during its compression does.
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

  it('names a baseline from today for an account whose rewind was cut off before its checkpoint', async () => {
    await signedUp('operator');
    const paused = await signedUp('paused');
    const now = Date.now();
    t.clock.now = () => now - 2 * DAY_MS;
    const old = (await t.stores.snapshot(paused.incarnation, 'baseline'))!;
    await t.env.db.prepare("INSERT INTO restores (id, incarnation, report_id, at, timeline, phase, created_at, updated_at) VALUES (9, ?, 1, 1, 't', 'fenced', 1, 1)").bind(paused.incarnation).run();
    await t.lifecycle(paused.id, "state = 'restoring', operation = 9");
    expect((await t.daily(now)).generation).toEqual({ outcome: 'ok', error: null });
    const { accounts } = await newest();
    const baseline = accounts.find(({ incarnation }) => incarnation === paused.incarnation)!.baseline;
    expect(baseline).not.toBe(old);
    expect(baseline).toMatch(new RegExp(`^${now}-`));
  });

  it('collects a generation at 30 days and with it only the pictures no kept generation names', async () => {
    await signedUp('operator');
    const keeper = await signedUp('keeper');
    const leaver = await signedUp('leaver');
    const shared = await uploaded(keeper.cookie, 'both hold this');
    expect(await uploaded(leaver.cookie, 'both hold this')).toBe(shared);
    const kept = await uploaded(keeper.cookie, 'kept');
    const gone = await uploaded(leaver.cookie, 'gone with the leaver');
    const first = Date.now() - 31 * DAY_MS;
    await t.daily(first);
    expect((await newest()).pictures.toSorted()).toEqual([shared, kept, gone].toSorted());
    expect((await t.delete('account', { method: 'password', proof: leaver.body.passwordProof }, leaver.cookie)).status).toBe(204);
    await t.settle();
    await t.daily(first + DAY_MS);
    expect((await newest()).pictures.toSorted()).toEqual([shared, kept].toSorted());
    expect(readdirSync(join(generationsDir(t.dir), POOL)).toSorted()).toEqual([shared, kept, gone].toSorted());
    await t.daily(first + 30 * DAY_MS + DAY_MS / 2);
    expect((await listGenerations(t.dir)).map(({ capturedAt }) => capturedAt).toSorted()).toEqual([first + DAY_MS, first + 30 * DAY_MS + DAY_MS / 2]);
    expect(readdirSync(join(generationsDir(t.dir), POOL)).toSorted()).toEqual([shared, kept].toSorted());
  });
});
