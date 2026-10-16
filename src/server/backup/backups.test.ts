import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { accountPath } from '../db/account-db';
import { DAY_MS } from '../http';
import { sessionCookie, signupBody, testApp } from '../testing';
import { COPIED, generationsDir, listGenerations, readManifest } from './generation';
import { dayStart } from './snapshots';

const HOUR_MS = 60 * 60 * 1000;
const sent: { url: string; body: unknown }[] = [];
// The webhook answers once this settles.
let answered: Promise<void> = Promise.resolve();

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp(async (url, init) => {
    sent.push({ url: url.href, body: JSON.parse(init.body!) });
    await answered;
    return new Response(null, { status: 204 });
  });
});
afterAll(() => t.dispose());
beforeEach(async () => {
  await t.reset();
  sent.length = 0;
  answered = Promise.resolve();
});

it('sends each standing alert once when a tick comes while another waits on the webhook', async () => {
  sessionCookie(await t.post('signup', signupBody('operator')));
  const at = dayStart(Date.now() + 3 * DAY_MS) + 4 * HOUR_MS;
  t.clock.now = () => at;
  let answer = () => {};
  answered = new Promise((resolve) => (answer = resolve));
  const first = t.env.backups.tick(t.env, at);
  await expect.poll(() => sent.length).toBe(1);
  const second = t.env.backups.tick(t.env, at + 60_000);
  // Time for a second tick of its own to reach the webhook too.
  await new Promise((resolve) => setTimeout(resolve, 200));
  answer();
  await Promise.all([first, second]);
  const texts = sent.map(({ body }) => (body as { text: string }).text);
  expect(texts).toContain('[Hazelle] 백업이 36시간 넘게 없음');
  expect(new Set(texts).size).toBe(texts.length);
});

it('raises the banner and the webhook once a day for a failed night after a backup older than 36 hours', async () => {
  const body = signupBody('operator');
  const cookie = sessionCookie(await t.post('signup', body));
  const incarnation = (await t.env.db.prepare('SELECT incarnation FROM accounts').first<string>('incarnation'))!;
  const bytes = new TextEncoder().encode('a picture');
  const id = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  expect((await t.put(`files/${id}`, bytes, cookie)).status).toBe(204);
  const now = Date.now();
  expect((await t.daily(now - 40 * HOUR_MS)).generation).toEqual({ outcome: 'ok', error: null });
  const [copied] = await listGenerations(t.dir);
  writeFileSync(join(generationsDir(t.dir), copied!.id, COPIED), `${new Date(now - 39 * HOUR_MS).toISOString()}\n`);
  // A generation captured and not yet copied counts for nothing.
  expect((await t.daily(now - 20 * HOUR_MS)).generation).toEqual({ outcome: 'ok', error: null });
  rmSync(join(t.dir, 'files', incarnation, id));

  expect((await t.daily(now)).generation).toMatchObject({ outcome: 'failed' });
  await t.env.backups.tick(t.env, now);
  await t.env.backups.tick(t.env, now + 1);
  expect(sent).toEqual([
    { url: 'https://alerts.test/hook', body: { content: '[Hazelle] 백업이 36시간 넘게 없음', text: '[Hazelle] 백업이 36시간 넘게 없음' } },
    { url: 'https://alerts.test/hook', body: { content: '[Hazelle] 오늘 백업 작업 실패', text: '[Hazelle] 오늘 백업 작업 실패' } },
  ]);
  const service = (await (await t.get('admin/service', cookie)).json()) as Record<string, unknown>;
  expect(service).toMatchObject({ warnings: ['backup-stale'], diskFreePercent: 50 });
  expect(service.backupAgeHours).toBeGreaterThanOrEqual(40);

  t.disk.freePercent = 19.9;
  await t.env.backups.tick(t.env, now + 2);
  expect(sent.at(-1)).toEqual({ url: 'https://alerts.test/hook', body: { content: '[Hazelle] 디스크 80% 초과', text: '[Hazelle] 디스크 80% 초과' } });
  expect(await (await t.get('admin/service', cookie)).json()).toMatchObject({ warnings: ['backup-stale', 'disk-full'], diskFreePercent: 19.9 });
});

it('captures a generation of its own for a fresh ask that comes while a daily job runs', async () => {
  sessionCookie(await t.post('signup', signupBody('operator')));
  const running = t.env.backups.daily(t.env, Date.now());
  const fresh = t.env.backups.fresh(t.env);
  await running;
  expect((await fresh).generation.outcome).toBe('ok');
  expect((await listGenerations(t.dir)).length).toBe(2);
});

it('names, for a fresh ask, a baseline of every account written since today’s, and publishes no generation when one of them cannot be taken', async () => {
  const body = signupBody('operator');
  const cookie = sessionCookie(await t.post('signup', body));
  const incarnation = (await t.env.db.prepare('SELECT incarnation FROM accounts').first<string>('incarnation'))!;
  await t.daily(Math.max(dayStart(Date.now()), Date.now() - 60_000));
  t.clock.now = () => Date.now();
  const write = { id: crypto.randomUUID(), kind: 'chat', parent: null, body: 'after the morning', baseRev: null };
  expect((await t.batch([write], cookie)).status).toBe(200);
  expect((await t.env.backups.fresh(t.env)).generation).toEqual({ outcome: 'ok', error: null });
  const newest = (await listGenerations(t.dir)).toSorted((a, b) => b.capturedAt - a.capturedAt)[0]!;
  const baseline = (await readManifest(join(generationsDir(t.dir), newest.id)))!.accounts[0]!.baseline;
  const named = await t.env.db.prepare('SELECT rev FROM snapshots WHERE id = ?').bind(baseline).first<number>('rev');
  expect(t.stores.inspect(incarnation).exec('SELECT rev FROM head')).toEqual([{ rev: named }]);

  rmSync(accountPath(t.dir, incarnation));
  t.restartProcess();
  expect(await t.env.backups.fresh(t.env)).toEqual({ snapshots: { outcome: 'failed', error: 'baseline-failed' }, generation: { outcome: 'failed', error: 'baseline-failed' } });
  expect(await listGenerations(t.dir)).toHaveLength(2);
});

it('records each step at its own start and end, including the baseline time before generation', async () => {
  sessionCookie(await t.post('signup', signupBody('operator')));
  const started = Date.now();
  let now = started;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const take = t.env.stores.snapshot;
  const baseline = vi.spyOn(t.env.stores, 'snapshot').mockImplementation(async (...args) => {
    const result = await take(...args);
    now += 5000;
    return result;
  });
  const copy = t.env.db.snapshot;
  const generation = vi.spyOn(t.env.db, 'snapshot').mockImplementation(async (path) => {
    await copy(path);
    now += 700;
  });
  try {
    expect((await t.env.backups.daily(t.env, started)).generation.outcome).toBe('ok');
    expect((await t.env.db.prepare('SELECT kind, started_at, ended_at FROM backup_runs ORDER BY id').all()).results).toEqual([
      { kind: 'daily', started_at: started, ended_at: started + 5000 },
      { kind: 'generation', started_at: started + 5000, ended_at: started + 5700 },
    ]);
  } finally {
    generation.mockRestore();
    baseline.mockRestore();
    clock.mockRestore();
  }
});
