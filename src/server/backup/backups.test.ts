import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { sessionCookie, signupBody, testApp } from '../testing';
import { COPIED, generationsDir, listGenerations } from './generation';
import { DAY_MS, dayStart } from './snapshots';

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
  expect(service).toMatchObject({ warnings: ['backup-stale'], diskFreePercent: expect.any(Number) });
  expect(service.backupAgeHours).toBeGreaterThanOrEqual(40);
});

it('captures a generation of its own for a fresh ask that comes while a daily job runs', async () => {
  sessionCookie(await t.post('signup', signupBody('operator')));
  const running = t.env.backups.daily(t.env, Date.now());
  const fresh = t.env.backups.fresh(t.env);
  await running;
  expect((await fresh).generation.outcome).toBe('ok');
  expect((await listGenerations(t.dir)).length).toBe(2);
});
