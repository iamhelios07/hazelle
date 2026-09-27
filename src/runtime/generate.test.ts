import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Connection, Model } from '../connectors/types';
import { generate } from './generate';

const model: Model = { id: 'm', name: 'm', input: null, output: null, contextLength: null, maxOutput: null, reasoning: null, tools: null };
const openRouter: Connection = { type: 'openrouter', label: 'OpenRouter', baseUrl: null, protocol: null, secret: 'sk-or-x', starred: [] };

function answer(status: number, body: string, headers: Record<string, string>) {
  const fetch = vi.fn(async () => new Response(body, { status, headers }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

async function run(connection = openRouter, target = model) {
  const texts: string[] = [];
  const reply = await generate({
    connection,
    model: target,
    messages: [{ role: 'user', content: '안녕' }],
    maxTokens: null,
    signal: new AbortController().signal,
    onText: (_, text) => texts.push(text),
  });
  return { reply, text: texts.join('') };
}

afterEach(() => vi.unstubAllGlobals());

describe('generate', () => {
  it('sends the built request through the relay and streams the reply', async () => {
    const fetch = answer(200, 'data: {"choices":[{"delta":{"content":"반가워요"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { 'x-relay': 'upstream' });
    const { reply, text } = await run();
    expect(text).toBe('반가워요');
    expect(reply).toMatchObject({ state: 'done', error: null, finishReason: 'stop' });
    expect(reply.firstTextMs).toBeGreaterThanOrEqual(0);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/relay');
    expect(JSON.parse(init.body as string)).toMatchObject({ url: 'https://openrouter.ai/api/v1/chat/completions', method: 'POST', headers: { authorization: 'Bearer sk-or-x' } });
  });

  it("tells the provider's refusal, the relay's and the app's apart", async () => {
    answer(401, '{"error":{"message":"No auth credentials found","code":401}}', { 'x-relay': 'upstream' });
    expect((await run()).reply).toMatchObject({ state: 'failed', error: { kind: 'provider', status: 401, detail: 'No auth credentials found' } });
    answer(502, '{"error":"upstream-unreachable"}', { 'x-relay': 'error' });
    expect((await run()).reply).toMatchObject({ state: 'failed', error: { kind: 'relay', code: 'upstream-unreachable' } });
    answer(401, '{"error":"no-session"}', {});
    expect((await run()).reply).toMatchObject({ state: 'failed', error: { kind: 'app', code: 'no-session' } });
  });

  it('refuses before sending when the request cannot be built', async () => {
    const fetch = answer(200, '', { 'x-relay': 'upstream' });
    const anthropic: Connection = { ...openRouter, type: 'anthropic', secret: 'sk-ant-x' };
    expect((await run(anthropic)).reply).toMatchObject({ state: 'failed', error: { kind: 'refused', code: 'max-tokens-unknown' } });
    expect((await run({ ...openRouter, type: 'someday' })).reply).toMatchObject({ error: { kind: 'refused', code: 'unknown-connection-type' } });
    expect(fetch).not.toHaveBeenCalled();
  });
});
