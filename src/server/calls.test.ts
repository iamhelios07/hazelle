import { expect, it } from 'vitest';
import { relayBudget, uploadBudget } from './limits';
import type { Upstream } from './relay';
import { replyKey, testApp } from './testing';

const request = { url: 'https://custom.example/v1/chat', method: 'POST', headers: {}, body: '{}' };
// A provider that answers at once and then sends nothing until the call is aborted.
const silent: Upstream = async (_url, { signal }) =>
  new Response(new ReadableStream({ start: (controller) => signal.addEventListener('abort', () => controller.error(signal.reason)) }));

it('holds an account to its live calls across detached replies and relayed calls, each freed as its call ends', async () => {
  const t = await testApp(silent, relayBudget(undefined, undefined, undefined, 2));
  try {
    await t.env.db.prepare('UPDATE service SET signup_cap = 2').run();
    const { cookie } = await t.signUp();
    const other = await t.signUp();
    const id = crypto.randomUUID();
    const started = await t.post(`streams/${id}`, { key: (await replyKey()).key, request }, cookie);
    const relayed = await t.post('relay', request, cookie);
    expect([started.status, relayed.status]).toEqual([200, 200]);
    await started.body!.cancel();
    for (const path of ['relay', `streams/${crypto.randomUUID()}`]) {
      const refused = await t.post(path, { key: (await replyKey()).key, request }, cookie);
      expect([refused.status, await refused.json()]).toEqual([429, { error: 'too-many-live-calls' }]);
    }
    await (await t.post('relay', request, other.cookie)).body!.cancel();

    await relayed.body!.cancel();
    const again = await t.post('relay', request, cookie);
    expect([again.status, (await t.post('relay', request, cookie)).status]).toEqual([200, 429]);
    await t.post(`streams/${id}/stop`, undefined, cookie);
    await t.env.streams.settled();
    const freed = await t.post('relay', request, cookie);
    expect(freed.status).toBe(200);
    await Promise.all([again.body!.cancel(), freed.body!.cancel()]);
  } finally {
    t.dispose();
  }
});

it('refuses a call before its body is read: no length, the day spent, or no room in memory', async () => {
  const t = await testApp(silent, relayBudget(1));
  try {
    const { id, cookie } = await t.signUp();
    const send = (path: string, body: string, length = true) =>
      t.raw(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(length && { 'content-length': String(body.length) }), cookie, 'x-account': id }, body });
    expect((await send('relay', 'not json', false)).status).toBe(411);
    t.env.limits.uploads = uploadBudget(4, 1);
    const busy = await send('relay', 'not json');
    expect([busy.status, ((await busy.json()) as { error: string }).error]).toEqual([503, 'busy']);
    t.env.limits.relay.account(id).take(1);
    for (const path of ['relay', `streams/${crypto.randomUUID()}`]) {
      const spent = await send(path, 'not json');
      expect([spent.status, spent.headers.get('x-relay'), await spent.json()]).toEqual([429, 'error', { error: 'relay-traffic-limit' }]);
    }
  } finally {
    t.dispose();
  }
});
