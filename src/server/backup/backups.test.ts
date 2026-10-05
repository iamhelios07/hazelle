import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { sessionCookie, signupBody, testApp } from '../testing';
import { COPIED, generationsDir, listGenerations } from './generation';

const HOUR_MS = 60 * 60 * 1000;
const sent: { url: string; body: unknown }[] = [];

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp(async (url, init) => {
    sent.push({ url: url.href, body: JSON.parse(init.body!) });
    return new Response(null, { status: 204 });
  });
});
afterAll(() => t.dispose());
beforeEach(async () => {
  await t.reset();
  sent.length = 0;
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
