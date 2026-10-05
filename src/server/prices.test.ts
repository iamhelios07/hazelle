import { afterAll, beforeAll, expect, it } from 'vitest';
import type { PriceList } from '../connectors/price-list';
import modelsDev from './fixtures/models-dev.json';
import { sessionCookie, signupBody, testApp } from './testing';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp(async () => Response.json(modelsDev));
});
afterAll(() => t.dispose());

it('stores the listed providers models.dev prices, leaving out what it cannot price whole, on the first ask', async () => {
  const cookie = sessionCookie(await t.post('signup', { ...signupBody('jin'), accountId: crypto.randomUUID() }));
  const read = async (list: string) => (await (await t.get(`prices?provider=${list}`, cookie)).json()) as PriceList;

  expect(await read('github-copilot')).toEqual({ fetchedAt: null, models: {} });
  await t.settle();
  const copilot = await read('github-copilot');
  expect(copilot.fetchedAt).toEqual(expect.any(Number));
  expect(copilot.models).toEqual({
    'gpt-5.4': { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: null, tiers: [{ above: 272000, input: 5, output: 22.5, cacheRead: 0.5, cacheWrite: null }] },
    'claude-opus-4.7': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, tiers: [] },
  });
  // A tier by anything but context size, and a model without a cost, cost 알 수 없음.
  expect(Object.keys((await read('deepinfra')).models)).toEqual(['deepseek-ai/DeepSeek-V4-Flash']);
  expect((await read('groq')).models).toEqual({});
  expect((await t.get('prices?provider=poe', cookie)).status).toBe(400);
});
