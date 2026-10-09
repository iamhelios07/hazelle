import { afterEach, expect, it, vi } from 'vitest';
import type { Model } from '../connectors/types';
import type { Stored } from '../model/kinds';
import { embedModel, type Route } from './assignment';
import { Credentials } from './credential';
import { embedTexts } from './embed';

const model: Model = { id: 'text-embedding-3-small', name: 'Small', input: ['text'], output: ['embedding'], contextLength: null, maxOutput: null, reasoning: null, tools: null, protocol: null, takes: { settings: null, reasoning: null }, price: { input: 0.02, output: 0, cacheRead: null, cacheWrite: null, tiers: [], asOf: 1 } };
const connection: Stored<'connection'> = { id: 'c', kind: 'connection', parent: null, rev: 1, value: { type: 'openai', label: 'OpenAI', baseUrl: null, protocol: null, accounts: [{ id: 'a', secret: 'sk' }], turns: null, starred: [model] } };
const route: Route = { connection, model };
const chat = crypto.randomUUID();
const deps = (tokens = 1) => ({ credentials: new Credentials(), count: async (texts: string[]) => texts.map(() => tokens) });
const upstream = (body: unknown, status = 200, relay: string | null = 'upstream') => vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => Response.json(body, { status, headers: relay ? { 'x-relay': relay } : {} }));

afterEach(() => vi.unstubAllGlobals());

it('refuses too many texts or too long a text before any network call', async () => {
  const fetch = upstream({});
  vi.stubGlobal('fetch', fetch);
  expect(await embedTexts(deps(), route, Array(65).fill('밤'), null, chat)).toEqual({ answer: { ok: false, reason: 'too-large' }, receipt: null });
  expect(await embedTexts(deps(8193), route, ['밤'], null, chat)).toEqual({ answer: { ok: false, reason: 'too-large' }, receipt: null });
  expect(fetch).not.toHaveBeenCalled();
});

it('relays naming its chat and keeps a receipt with input tokens and the price-list cost', async () => {
  const fetch = upstream({ data: [{ index: 0, embedding: [0.1, 0.2] }], usage: { prompt_tokens: 500_000 } });
  vi.stubGlobal('fetch', fetch);
  const { answer, receipt } = await embedTexts(deps(), route, ['밤'], 'query', chat);
  expect(answer).toEqual({ ok: true, model: 'text-embedding-3-small', vectors: [[0.1, 0.2]] });
  expect(receipt).toMatchObject({ connection: 'c', account: 'a', source: 'OpenAI', model: 'text-embedding-3-small', state: 'done', error: null, usage: { inputTokens: 500_000, outputTokens: 0 }, cost: { unit: 'usd', amount: 0.01, source: 'price-list' } });
  const [url, init] = fetch.mock.calls[0]!;
  expect(url).toBe('/api/relay');
  expect((init.headers as Record<string, string>)['x-hazelle-bot']).toBe(chat);
  expect(JSON.parse(init.body as string)).toMatchObject({ url: 'https://api.openai.com/v1/embeddings', headers: { authorization: 'Bearer sk' } });
});

it('answers flood when the server refuses the chat’s bot call, with no receipt', async () => {
  vi.stubGlobal('fetch', upstream({ error: 'too-many-bot-calls' }, 429, null));
  expect(await embedTexts(deps(), route, ['밤'], null, chat)).toEqual({ answer: { ok: false, reason: 'flood' }, receipt: null });
});

it('fails with a failed receipt when the answer is not an embedding answer or the provider refuses', async () => {
  vi.stubGlobal('fetch', upstream({ data: [] }));
  const unparsed = await embedTexts(deps(), route, ['밤'], null, chat);
  expect(unparsed.answer).toEqual({ ok: false, reason: 'failed' });
  expect(unparsed.receipt).toMatchObject({ state: 'failed', error: { kind: 'bad-event' } });
  vi.stubGlobal('fetch', upstream({ error: { message: 'bad key' } }, 401));
  expect((await embedTexts(deps(), route, ['밤'], null, chat)).receipt).toMatchObject({ state: 'failed', error: { kind: 'provider', status: 401 } });
});

it('refuses a connection that serves no embeddings before the network', async () => {
  const fetch = upstream({});
  vi.stubGlobal('fetch', fetch);
  const groq: Route = { connection: { ...connection, value: { ...connection.value, type: 'groq' } }, model };
  expect(await embedTexts(deps(), groq, ['밤'], null, chat)).toEqual({ answer: { ok: false, reason: 'failed' }, receipt: null });
  expect(fetch).not.toHaveBeenCalled();
});

it('takes 임베딩 모델 from 기본값 alone, and counts one whose connection serves none as gone', () => {
  const groq: Stored<'connection'> = { ...connection, id: 'g', value: { ...connection.value, type: 'groq' } };
  const store = (embed?: { connection: string; model: string }) => ({
    get: ((kind: string, id: string) => (kind === 'settings' ? { value: { models: { main: { connection: 'c', model: model.id }, ...(embed && { embed }) } } } : [connection, groq].find((each) => each.id === id))) as never,
  });
  expect(embedModel(store())).toEqual({ kind: 'no-model' });
  expect(embedModel(store({ connection: 'c', model: model.id }))).toMatchObject({ connection: { id: 'c' }, model: { id: model.id } });
  expect(embedModel(store({ connection: 'g', model: model.id }))).toEqual({ kind: 'model-gone' });
  expect(embedModel(store({ connection: 'c', model: 'unstarred' }))).toEqual({ kind: 'model-gone' });
});
