import { afterAll, beforeAll, expect, it } from 'vitest';
import type { ModelsDevList } from '../connectors/models-dev';
import modelsDev from './fixtures/models-dev.json';
import { sessionCookie, signupBody, testApp } from './testing';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp(async () => Response.json(modelsDev));
});
afterAll(() => t.dispose());

it('stores the listed providers models.dev prices and inputs and outputs, pricing only what it can price whole, on the first ask', async () => {
  const cookie = sessionCookie(await t.post('signup', { ...signupBody('jin'), accountId: crypto.randomUUID() }));
  const read = async (list: string) => (await (await t.get(`models-dev?provider=${list}`, cookie)).json()) as ModelsDevList;

  expect(await read('github-copilot')).toEqual({ fetchedAt: null, models: {} });
  await t.settle();
  const copilot = await read('github-copilot');
  expect(copilot.fetchedAt).toEqual(expect.any(Number));
  expect(copilot.models).toEqual({
    'gpt-5.4': {
      price: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: null, tiers: [{ above: 272000, input: 5, output: 22.5, cacheRead: 0.5, cacheWrite: null }] },
      input: ['text', 'image', 'file'],
      output: ['text'],
    },
    'claude-opus-4.7': { price: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, tiers: [] }, input: ['text', 'image', 'file'], output: ['text'] },
  });
  // A tier by anything but context size, and a model without a cost, cost 알 수 없음; a word the app has no name for is dropped.
  expect((await read('deepinfra')).models['by-time']).toEqual({ price: null, input: ['text', 'file'], output: ['text'] });
  expect((await read('groq')).models).toEqual({
    'whisper-large-v3': { price: null, input: ['audio'], output: ['text'] },
    'priced-only': { price: { input: 1, output: 2, cacheRead: null, cacheWrite: null, tiers: [] }, input: null, output: null },
  });
  expect((await t.get('models-dev?provider=poe', cookie)).status).toBe(400);
});
