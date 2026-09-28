import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Connection, Model, Starred } from '../connectors/types';
import { Credentials } from './credential';
import { generate } from './generate';
import { stubRelay, upstream } from './testing';

const model: Model = { id: 'm', name: 'm', input: null, output: null, contextLength: null, maxOutput: null, reasoning: null, tools: null, protocol: null };
const openRouter: Connection = { type: 'openrouter', label: 'OpenRouter', baseUrl: null, protocol: null, secret: 'sk-or-x', starred: [] };

const answer = (status: number, body: string, headers: Record<string, string>) => stubRelay(() => new Response(body, { status, headers }));

async function run(connection = openRouter, target: Starred = model, credentials = new Credentials()) {
  const texts: string[] = [];
  const reply = await generate({
    credentials,
    connection,
    model: target,
    messages: [{ role: 'user', content: '안녕' }],
    signal: new AbortController().signal,
    onText: (_, text) => texts.push(text),
  });
  return { reply, text: texts.join('') };
}

afterEach(() => vi.unstubAllGlobals());

describe('generate', () => {
  it('sends the built request through the relay and streams the reply', async () => {
    const log = answer(200, 'data: {"choices":[{"delta":{"content":"반가워요"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { 'x-relay': 'upstream' });
    const { reply, text } = await run();
    expect(text).toBe('반가워요');
    expect(reply).toMatchObject({ state: 'done', error: null, finishReason: 'stop' });
    expect(reply.firstTextMs).toBeGreaterThanOrEqual(0);
    expect(log[0]!.sent).toMatchObject({ url: 'https://openrouter.ai/api/v1/chat/completions', method: 'POST', headers: { authorization: 'Bearer sk-or-x' } });
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
    const log = answer(200, '', { 'x-relay': 'upstream' });
    const anthropic: Connection = { ...openRouter, type: 'anthropic', secret: 'sk-ant-x' };
    expect((await run(anthropic)).reply).toMatchObject({ state: 'failed', error: { kind: 'refused', code: 'max-tokens-unknown' } });
    expect((await run({ ...openRouter, type: 'someday' })).reply).toMatchObject({ error: { kind: 'refused', code: 'unknown-connection-type' } });
    expect(log).toEqual([]);
  });

  it('sends the starred model’s settings, and refuses one its catalog says it does not take', async () => {
    const log = answer(200, 'data: {"choices":[{"delta":{"content":"네"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { 'x-relay': 'upstream' });
    const listed: Starred = { ...model, takes: { settings: ['temperature'], reasoning: null } };
    await run(openRouter, { ...listed, settings: { temperature: 0.7 } });
    expect(JSON.parse(log[0]!.sent.body!)).toMatchObject({ temperature: 0.7 });
    expect((await run(openRouter, { ...listed, settings: { topP: 0.9 } })).reply).toMatchObject({ state: 'failed', error: { kind: 'refused', code: 'setting-refused' } });
    expect(log).toHaveLength(1);
  });
});

describe('a connection that trades its key for a token', () => {
  const copilot: Connection = { type: 'copilot', label: 'Copilot · jin', baseUrl: null, protocol: null, secret: 'gho_x', starred: [] };
  const gpt: Model = { ...model, id: 'gpt-4.1' };
  const EXCHANGE = 'https://api.github.com/copilot_internal/v2/token';
  const CHAT = 'https://api.githubcopilot.com/chat/completions';

  // Answers the exchange with a token that lasts the given seconds, and a chat with a one-word reply.
  function copilotApi(lasts: number) {
    const log = stubRelay(({ url }) =>
      url === EXCHANGE
        ? upstream(200, { token: 'tid', expires_at: Math.floor(Date.now() / 1000) + lasts })
        : new Response('data: {"choices":[{"delta":{"content":"네"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'x-relay': 'upstream' } }),
    );
    return () => log.map((call) => call.sent);
  }

  it('sends the traded token, and trades again only when it nears its end', async () => {
    const sent = copilotApi(1800);
    const credentials = new Credentials();
    expect((await run(copilot, gpt, credentials)).text).toBe('네');
    await run(copilot, gpt, credentials);
    expect(sent().map((call) => call.url)).toEqual([EXCHANGE, CHAT, CHAT]);
    expect(sent()[0]!.headers.authorization).toBe('Bearer gho_x');
    expect(sent()[1]!.headers.authorization).toBe('Bearer tid');

    const shortLived = copilotApi(30);
    const fresh = new Credentials();
    await run(copilot, gpt, fresh);
    await run(copilot, gpt, fresh);
    expect(shortLived().map((call) => call.url)).toEqual([EXCHANGE, CHAT, EXCHANGE, CHAT]);
  });

  it('stops before the chat when the trade is refused', async () => {
    const log = answer(401, '{"message":"Bad credentials"}', { 'x-relay': 'upstream' });
    expect((await run(copilot, gpt)).reply).toMatchObject({ state: 'failed', error: { kind: 'provider', status: 401, detail: 'Bad credentials' } });
    expect(log).toHaveLength(1);
  });

  it('refuses a model it cannot call before trading for a token', async () => {
    const log = answer(200, '', { 'x-relay': 'upstream' });
    expect((await run(copilot, { ...gpt, protocol: 'unsupported' })).reply).toMatchObject({ error: { kind: 'refused', code: 'unsupported-protocol' } });
    expect(log).toEqual([]);
  });
});
