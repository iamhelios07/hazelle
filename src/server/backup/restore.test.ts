import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { serviceReads, type Phase } from '../account-store';
import { accountRegistry } from '../db/account-db';
import { openDatabase, serviceDb, type Db, type Statement } from '../db/service-db';
import { diskBucket } from '../files/disk-bucket';
import { sha256Hex, type Services } from '../http';
import { beginRestore, runRestore } from '../lifecycle';
import { tokenBucket } from '../limits';
import { streamRegistry } from '../stream-registry';
import { proof, sessionCookie, signupBody, testApp } from '../testing';
import app from '../worker';
import { backups } from './backups';
import { generationsDir, listGenerations, MANIFEST, readManifest } from './generation';
import { restoreGeneration } from './restore';

const HOUR_MS = 60 * 60 * 1000;
const X = '11111111-1111-4111-8111-111111111111';

let t: Awaited<ReturnType<typeof testApp>>;
const scratch: string[] = [];
beforeAll(async () => {
  t = await testApp();
  await t.env.db.prepare('UPDATE service SET signup_cap = 100').run();
});
afterAll(() => {
  t.dispose();
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});
const emptyDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'hazelle-restore-'));
  scratch.push(dir);
  return dir;
};

class Stop extends Error {}

// env whose run stops right after the operation's phase moved to `phase`, as a process killed there leaves it.
function stoppingAt(phase: Phase): Services {
  const db: Db = {
    ...t.env.db,
    prepare: (sql) => {
      const real = t.env.db.prepare(sql);
      if (!sql.startsWith('UPDATE restores SET phase = ?')) return real;
      return {
        ...real,
        bind: (...values: Parameters<Statement['bind']>) => {
          const bound = real.bind(...values);
          return values[0] === phase ? ({ ...bound, run: async () => (await bound.run(), Promise.reject(new Stop())) } as Statement) : bound;
        },
      } as Statement;
    },
  };
  return { ...t.env, db };
}

async function signedUp(username: string) {
  const body = signupBody(username);
  const cookie = sessionCookie(await t.post('signup', body));
  const row = (await t.env.db.prepare('SELECT incarnation, timeline FROM accounts WHERE id = ?').bind(body.accountId).first<{ incarnation: string; timeline: string }>())!;
  return { id: body.accountId, cookie, ...row };
}

// An account holding X 'old' in a baseline from an hour ago, then X 'new', and a restore to between them left at `phase`.
async function leftAt(username: string, phase: Phase) {
  const now = Date.now();
  t.clock.now = () => now - HOUR_MS;
  const user = await signedUp(username);
  const write = (body: string, baseRev: number | null) => t.stores.getByName(user.incarnation).batch(user.incarnation, user.timeline, [{ id: X, kind: 'chat', parent: null, body, baseRev }], null);
  await write('old', null);
  await t.stores.snapshot(user.incarnation, 'baseline');
  t.clock.now = () => now - HOUR_MS / 2;
  await write('new', 1);
  t.clock.now = () => Date.now();
  expect((await t.post('reports', { text: 'restore' }, user.cookie)).status).toBe(204);
  const report = (await t.env.db.prepare('SELECT MAX(id) AS id FROM reports WHERE account_id = ?').bind(user.id).first<number>('id'))!;
  const begun = await beginRestore(t.env, user.id, report, { at: now - (3 * HOUR_MS) / 4 });
  const operation = (begun as { begun: number }).begun;
  await expect(runRestore(stoppingAt(phase), operation)).rejects.toThrow(Stop);
  return { ...user, report, operation };
}

const bytesOf = (text: string) => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
const idOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

it('restores a generation into an empty directory: logins, counts, pictures and blocks, every operation ended by its phase, old timelines refused', async () => {
  const operator = await signedUp('operator');
  const kept = bytesOf('a kept picture');
  const blocked = bytesOf('a blocked picture');
  for (const bytes of [kept, blocked]) expect((await t.put(`files/${idOf(bytes)}`, bytes, operator.cookie)).status).toBe(204);
  expect((await t.put(`admin/files/${idOf(blocked)}/blocked`, { blocked: true }, operator.cookie)).status).toBe(204);
  const targeted = await leftAt('targeted', 'targeted');
  const armed = await leftAt('armed', 'armed');
  const rewound = await leftAt('rewound', 'rewound');
  const leaver = await signedUp('leaver');
  expect((await t.put(`files/${idOf(bytesOf('leaving'))}`, bytesOf('leaving'), leaver.cookie)).status).toBe(204);
  await t.lifecycle(leaver.id, "state = 'leaving'");

  expect((await t.daily(Date.now())).generation).toEqual({ outcome: 'ok', error: null });
  const { id } = (await listGenerations(t.dir))[0]!;
  const generation = join(generationsDir(t.dir), id);
  expect((await readManifest(generation))!.operations.map(({ phase }) => phase)).toEqual(['targeted', 'armed', 'rewound']);

  const dir = emptyDir();
  expect(await restoreGeneration(generation, dir, 'migrations')).toEqual({
    accounts: 4,
    pictures: 2,
    deleted: 1,
    operations: [
      { id: targeted.operation, phase: 'cancelled' },
      { id: armed.operation, phase: 'done' },
      { id: rewound.operation, phase: 'done' },
    ],
  });

  const raw = openDatabase(join(dir, 'service.sqlite'));
  const db = serviceDb(raw);
  const outbound = () => Promise.reject(new Error('no provider'));
  const env: Services = {
    db,
    files: diskBucket(dir),
    stores: accountRegistry(dir, db, serviceReads(db), Date.now),
    streams: streamRegistry(outbound),
    outbound,
    limits: { calls: tokenBucket(240), botCalls: tokenBucket(20) },
    backups: backups(dir, 3, null),
  };
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} };
  try {
    const send = async (method: string, path: string, body?: unknown, cookie?: string) => {
      const account = cookie && (await db.prepare('SELECT account_id FROM sessions WHERE token_hash = ?').bind(await sha256Hex(cookie.split('=')[1]!)).first<string>('account_id'));
      return app.request(
        `/api/${path}`,
        { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie, ...(account ? { 'x-account': account } : {}) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) },
        env,
        ctx as never,
      );
    };
    const login = async (username: string, method: 'password' | 'recovery') => {
      const answer = await send('POST', 'login', { username, method, proof: proof(method) });
      expect(answer.status).toBe(200);
      return sessionCookie(answer);
    };
    const contents = async (cookie: string) => ((await (await send('GET', 'objects?since=0', undefined, cookie)).json()) as { changes: { body: string }[] }).changes.map(({ body }) => body);

    const operatorCookie = await login('operator', 'password');
    expect(new Uint8Array(await (await send('GET', `files/${idOf(kept)}`, undefined, operatorCookie)).arrayBuffer())).toEqual(kept);
    expect((await send('GET', `files/${idOf(blocked)}`, undefined, operatorCookie)).status).toBe(403);
    expect((await send('GET', `objects?since=0&timeline=${operator.timeline}`, undefined, operatorCookie)).status).toBe(409);
    expect((await send('POST', 'login', { username: 'leaver', method: 'password', proof: proof('password') })).status).toBe(401);
    expect(existsSync(join(dir, 'files', leaver.incarnation))).toBe(false);
    expect(readdirSync(join(dir, 'files'))).toEqual([operator.incarnation]);

    expect(await contents(await login('targeted', 'recovery'))).toEqual(['new']);
    expect(await contents(await login('rewound', 'password'))).toEqual(['old']);
    const armedCookie = await login('armed', 'password');
    expect(await contents(armedCookie)).toEqual(['old']);
    // The undo of an operation finished by the restore gives back the state it replaced.
    const undo = await beginRestore(env, armed.id, armed.report, { undoes: armed.operation });
    expect(await runRestore(env, (undo as { begun: number }).begun)).toMatchObject({ phase: 'done', verified: true });
    expect(await contents(armedCookie)).toEqual(['new']);
  } finally {
    env.stores.close();
    raw.close();
  }

  // Refused before anything is written: a directory that is not empty, a corrupt artifact, a generation with no manifest.
  await expect(restoreGeneration(generation, dir, 'migrations')).rejects.toThrow(/not empty/);
  const manifest = (await readManifest(generation))!;
  writeFileSync(join(generation, manifest.snapshots[0]!.path), 'torn');
  const clean = emptyDir();
  await expect(restoreGeneration(generation, clean, 'migrations')).rejects.toThrow(/corrupt/);
  expect(readdirSync(clean)).toEqual([]);
  rmSync(join(generation, MANIFEST));
  await expect(restoreGeneration(generation, clean, 'migrations')).rejects.toThrow(/no manifest/);
}, 60_000);
