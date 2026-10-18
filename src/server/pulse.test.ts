import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { PULSE_HEADER } from '../contracts/http';
import { pulseHeader, type PulseAnswer, type PulseRole } from '../contracts/pulse';
import { replyKey, testApp } from './testing';

const request = { url: 'https://api.example.com/v1/chat', method: 'POST', headers: {}, body: '{}' };
// Wednesday 2026-10-21, 12:00 KST.
const NOON = Date.parse('2026-10-21T03:00:00Z');
// Its week's start: Monday 2026-10-19, 00:00 KST.
const WEEK_FROM = Date.parse('2026-10-18T15:00:00Z');
const HOUR = 60 * 60 * 1000;
const WEEK = 7 * 24 * HOUR;
let answers: number[] = [];

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp(async () => new Response('{}', { status: answers.shift() ?? 200, headers: { 'content-type': 'application/json', 'retry-after': '0' } }));
});
afterAll(() => t.dispose());
beforeEach(async () => {
  await t.reset();
  answers = [];
  await t.env.db.batch([t.env.db.prepare('UPDATE service SET signup_cap = 100'), t.env.db.prepare('UPDATE pulse_start SET starts = 0')]);
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

it('ignores every label before the start, and answers when counting starts', async () => {
  const starts = NOON + 24 * HOUR;
  await t.env.db.prepare('UPDATE pulse_start SET starts = ?').bind(starts).run();
  await t.restartPulse();
  const cookies = await people(10);
  await seen(cookies);
  for (const cookie of cookies) await call(cookie, 'image', 'novelai', 'nai-diffusion-5-full');
  const answer = await t.get('pulse');
  expect(answer.headers.get('cache-control')).toBe('public, max-age=300');
  expect(await answer.json()).toEqual({ starts, at: NOON, board: null });
  expect(await hourCalls()).toEqual([]);
  expect((await t.env.db.prepare('SELECT COUNT(*) AS n FROM pulse_week').first('n'))).toBe(0);
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
    merged: [{ model: null, share: 1, people: 5 }],
    split: [{ model: null, type: 'direct', share: 1, people: 5 }],
  });
  await call(cookies[4]!, 'image', 'novelai', 'nai-diffusion-5-full');
  at(NOON + 15 * 60 * 1000);
  expect((await board())?.ranking.image.merged).toEqual([
    { model: 'NovelAI Diffusion V5 Full', share: 1, people: 5 },
    { model: null, share: 1, people: 5 },
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
      { model: 'GLM-5.2', share: 14 / 19, people: 5, replies: 10 },
      { model: null, share: 5 / 19, people: 5, replies: 10 },
    ],
    split: [{ model: null, type: 'openrouter', share: 5 / 19, people: 5, replies: 10 }],
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
