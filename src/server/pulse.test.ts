import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { PULSE_HEADER } from '../contracts/http';
import { pulseHeader, type PulseAnswer, type PulseRole } from '../contracts/pulse';
import { forgetPulseHours } from './pulse';
import { replyKey, testApp } from './testing';

const request = { url: 'https://api.example.com/v1/chat', method: 'POST', headers: {}, body: '{}' };
// Wednesday 2026-10-21, 12:00 KST.
const NOON = Date.parse('2026-10-21T03:00:00Z');
// Its week's start: Monday 2026-10-19, 00:00 KST.
const WEEK_FROM = Date.parse('2026-10-18T15:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
let answers: number[] = [];

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp(async () => new Response('{}', { status: answers.shift() ?? 200, headers: { 'content-type': 'application/json', 'retry-after': '0' } }));
});
afterAll(() => t.dispose());
beforeEach(async () => {
  await t.reset();
  answers = [];
  await t.env.db.prepare('UPDATE service SET signup_cap = 100').run();
  await t.restartPulse();
  at(NOON);
});

const at = (now: number) => {
  t.clock.now = () => now;
};
const people = async (count: number) => Promise.all(Array.from({ length: count }, async () => (await t.signUp()).cookie));
const label = (role: PulseRole, type: string, model: string) => ({ [PULSE_HEADER]: pulseHeader({ kind: 'call', role, type, model }) });
const call = async (cookie: string, role: PulseRole, type: string, model: string) => {
  const answer = await t.post('relay', request, cookie, label(role, type, model));
  await answer.text();
  await t.settle();
  return answer.status;
};
const seen = async (cookies: string[]) => {
  for (const cookie of cookies) await t.get('session', cookie, { [PULSE_HEADER]: 'seen' });
  await t.settle();
};
const board = async () => ((await (await t.get('pulse')).json()) as PulseAnswer).board;
const hourCalls = async () => (await t.env.db.prepare('SELECT role, calls FROM pulse_hours').all()).results;

it('answers with no board before anyone is counted, cached publicly for 5 minutes', async () => {
  const answer = await t.get('pulse');
  expect(answer.headers.get('cache-control')).toBe('public, max-age=300');
  expect(await answer.json()).toEqual({ at: NOON, board: null });
});

it('shows the board from 10 people this week and a row from 5 people on it, naming only a model a list confirms', async () => {
  const cookies = await people(10);
  await seen(cookies.slice(0, 9));
  expect(await board()).toBeNull();
  await seen(cookies);
  at(NOON + 5 * 60 * 1000);
  expect((await board())?.week).toEqual({ from: WEEK_FROM, people: 10 });

  for (const cookie of cookies.slice(0, 4)) await call(cookie, 'image', 'novelai', 'nai-diffusion-5-full');
  for (const cookie of cookies.slice(0, 5)) await call(cookie, 'image', 'direct', 'nai-diffusion-5-full');
  at(NOON + 10 * 60 * 1000);
  // Four on NovelAI's V5 stay in memory alone; the five through a generic connection make 기타, never its name.
  expect((await board())?.ranking.image).toEqual({
    merged: [{ key: '', model: null, share: 1, people: 5 }],
    split: [{ key: '', model: null, type: 'direct', share: 1, people: 5 }],
  });
  await call(cookies[4]!, 'image', 'novelai', 'nai-diffusion-5-full');
  at(NOON + 15 * 60 * 1000);
  expect((await board())?.ranking.image.merged).toEqual([
    { key: 'novelai diffusion v5 full', model: 'NovelAI Diffusion V5 Full', share: 1, people: 5 },
    { key: '', model: null, share: 1, people: 5 },
  ]);
});

it('merges one model across lists by its name and ranks 대화 by the last 24 hours of replies', async () => {
  await t.env.db.prepare("INSERT INTO models_dev (list, model, name) VALUES ('openrouter', 'z-ai/glm-5.2', 'GLM-5.2'), ('deepinfra', 'zai-org/GLM-5.2', 'GLM 5.2 (latest)')").run();
  const cookies = await people(10);
  await seen(cookies);
  for (const cookie of cookies.slice(0, 3)) for (let reply = 0; reply < 4; reply++) await call(cookie, 'chat', 'openrouter', 'z-ai/glm-5.2');
  for (const cookie of cookies.slice(3, 5)) await call(cookie, 'chat', 'deepinfra', 'zai-org/GLM-5.2');
  for (const cookie of cookies.slice(5)) await call(cookie, 'chat', 'openrouter', 'someone/private-tune');
  // The hour is whole, and in the window, an hour later.
  at(NOON + HOUR);
  const answer = (await board())!;
  expect(answer.replies).toBe(20);
  expect(answer.hours.at(-1)).toEqual({ at: NOON, calls: { chat: 20, aux: 0, image: 0, embedding: 0 } });
  expect(answer.ranking.chat).toEqual({
    merged: [
      { key: 'glm 5.2', model: 'GLM-5.2', share: 14 / 19, people: 5, replies: 10 },
      { key: '', model: null, share: 5 / 19, people: 5, replies: 10 },
    ],
    split: [{ key: '', model: null, type: 'openrouter', share: 5 / 19, people: 5, replies: 10 }],
    // GLM's split rows have 3 and 2 people, so its 14 replies are 순위 밖 there.
    rest: { merged: { share: 0, replies: 0 }, split: { share: 14 / 19, replies: 10 } },
  });
});

it('counts a call once its provider answered 2xx, once after a stream retried', async () => {
  const [cookie] = await people(1);
  answers = [500];
  expect(await call(cookie!, 'aux', 'openai', 'gpt-5')).toBe(500);
  expect(await hourCalls()).toEqual([]);

  const stream = async (tries: number[]) => {
    answers = tries;
    const id = crypto.randomUUID();
    const started = await t.post(`streams/${id}`, { key: (await replyKey()).key, request, retry: { times: 1, statuses: [429] } }, cookie, label('aux', 'openai', 'gpt-5'));
    await started.body!.cancel();
    await t.env.streams.settled();
    await t.settle();
    return id;
  };
  await stream([429, 429]);
  expect(await hourCalls()).toEqual([]);
  const id = await stream([429, 200]);
  // A pick-up read carries no label.
  await (await t.get(`streams/${id}`, cookie)).body!.cancel();
  expect(await hourCalls()).toEqual([{ role: 'aux', calls: 1 }]);
});

it('starts every week empty', async () => {
  const cookies = await people(10);
  await seen(cookies);
  at(NOON + WEEK);
  await seen(cookies.slice(0, 9));
  expect(await board()).toBeNull();
  expect((await t.env.db.prepare('SELECT week, people FROM pulse_week').all()).results).toEqual([{ week: WEEK_FROM, people: 10 }]);
});

it('only undercounts after a restart: stored rows keep their people, and replies under the floor are lost', async () => {
  const cookies = await people(6);
  for (const cookie of cookies) await call(cookie, 'embedding', 'voyage', 'voyage-4');
  for (const cookie of cookies.slice(0, 4)) await call(cookie, 'chat', 'direct', 'tune');
  await t.restartPulse();
  for (const cookie of cookies) await call(cookie, 'embedding', 'voyage', 'voyage-4');
  await call(cookies[4]!, 'chat', 'direct', 'tune');
  expect((await t.env.db.prepare("SELECT type, name, people FROM pulse_week_models WHERE role = 'embedding'").all()).results).toEqual([
    { type: '', name: 'voyage-4', people: 6 },
    { type: 'voyage', name: 'voyage-4', people: 6 },
  ]);
  expect(await t.env.db.prepare('SELECT COUNT(*) AS n FROM pulse_hour_replies').first('n')).toBe(0);
});

const insert = (table: string, ...rows: (string | number | null)[][]) =>
  t.env.db.batch(rows.map((row) => t.env.db.prepare(`INSERT INTO ${table} VALUES (${row.map(() => '?').join(', ')})`).bind(...row)));
const EMPTY = { merged: [], split: [] };

it('keeps each hour 48 hours past its end, so the day before the board stays whole off the hour', async () => {
  for (const table of ['pulse_hours', 'pulse_hour_replies']) {
    const row = (hour: number) => (table === 'pulse_hours' ? [hour, 'chat', 1] : [hour, '', '', null, 1]);
    await insert(table, row(NOON - 2 * DAY), row(NOON - 2 * DAY - HOUR));
  }
  await forgetPulseHours(t.env.db, NOON + 30 * 60 * 1000);
  for (const table of ['pulse_hours', 'pulse_hour_replies']) expect((await t.env.db.prepare(`SELECT hour FROM ${table}`).all()).results).toEqual([{ hour: NOON - 2 * DAY }]);
});

it('marks 대화 against the 24 hours before, ranked as the board ranks them, unless those hours reach before the start', async () => {
  await insert('pulse_week', [WEEK_FROM, 10]);
  await insert('pulse_week_models', [WEEK_FROM, 'chat', 'a', '', 'A', 5], [WEEK_FROM, 'chat', 'b', '', 'B', 6], [WEEK_FROM, 'chat', 'a', 'openai', 'A', 5]);
  await insert(
    'pulse_hour_replies',
    [NOON - DAY - HOUR, 'a', '', 'A', 30],
    [NOON - DAY - HOUR, 'a', 'openai', 'A', 30],
    [NOON - DAY - HOUR, 'b', '', 'B', 10],
    // Before the day before.
    [NOON - 2 * DAY - HOUR, 'b', '', 'B', 99],
    [NOON - HOUR, 'b', '', 'B', 30],
    [NOON - HOUR, 'a', '', 'A', 10],
  );
  at(NOON + 30 * 60 * 1000);
  const answer = (await board())!;
  expect(answer.ranking.chat.merged.map((row) => row.key)).toEqual(['b', 'a']);
  expect(answer.before.chat).toEqual({ merged: [{ key: 'a' }, { key: 'b' }], split: [{ key: 'a', type: 'openai' }] });
});

it('marks the other roles against last week by people, unless last week never showed its board', async () => {
  const last = WEEK_FROM - WEEK;
  await insert('pulse_week', [WEEK_FROM, 10]);
  expect((await board())!.before).toEqual({ chat: EMPTY, aux: null, image: null, embedding: null });
  await insert('pulse_week', [last, 12]);
  await insert('pulse_week_roles', [last, 'aux', 10]);
  await insert('pulse_week_models', [last, 'aux', 'x', '', 'X', 5], [last, 'aux', 'y', '', 'Y', 8], [last, 'aux', 'y', 'openai', 'Y', 8]);
  at(NOON + 10 * 60 * 1000);
  expect((await board())!.before).toEqual({ chat: EMPTY, aux: { merged: [{ key: 'y' }, { key: 'x' }], split: [{ key: 'y', type: 'openai' }] }, image: EMPTY, embedding: EMPTY });
});

it('lists the earlier weeks and answers each by its people, against the week before it, and nothing else', async () => {
  const [last, older] = [WEEK_FROM - WEEK, WEEK_FROM - 2 * WEEK];
  await insert('pulse_week', [WEEK_FROM, 10], [last, 12], [older, 11]);
  await insert('pulse_week_roles', [last, 'chat', 10], [last, 'aux', 5], [older, 'chat', 8]);
  await insert('pulse_week_models', [last, 'chat', 'a', '', 'A', 6], [last, 'chat', '', '', null, 5], [last, 'aux', 'x', 'openai', 'X', 5], [older, 'chat', '', '', null, 7], [older, 'chat', 'a', '', 'A', 5]);
  expect((await board())!.weeks).toEqual([last, older]);

  const week = async (from: number | string) => t.get(`pulse/weeks/${from}`);
  const found = await week(last);
  expect(found.headers.get('cache-control')).toBe('public, max-age=86400');
  const answer = {
    from: last,
    people: 12,
    ranking: {
      chat: { merged: [{ key: 'a', model: 'A', share: 0.6, people: 6 }, { key: '', model: null, share: 0.5, people: 5 }], split: [] },
      aux: { merged: [], split: [{ key: 'x', model: 'X', type: 'openai', share: 1, people: 5 }] },
      image: EMPTY,
      embedding: EMPTY,
    },
    before: { chat: { merged: [{ key: '' }, { key: 'a' }], split: [] }, aux: EMPTY, image: EMPTY, embedding: EMPTY },
  };
  expect(await found.json()).toEqual(answer);
  expect(((await (await week(older)).json()) as { before: unknown }).before).toEqual({ chat: null, aux: null, image: null, embedding: null });
  // A past week is answered once.
  await t.env.db.prepare('DELETE FROM pulse_week_models').run();
  expect(await (await week(last)).json()).toEqual(answer);

  for (const from of ['abc', last + 1, WEEK_FROM, older - WEEK]) {
    const missing = await week(from);
    expect([from, missing.status, await missing.json()]).toEqual([from, 404, { error: 'not-found' }]);
  }
});

it("keeps 대화's weekly people total for the past weeks", async () => {
  const cookies = await people(5);
  for (const cookie of cookies) await call(cookie, 'chat', 'direct', 'tune');
  expect((await t.env.db.prepare('SELECT week, role, people FROM pulse_week_roles').all()).results).toEqual([{ week: WEEK_FROM, role: 'chat', people: 5 }]);
});
