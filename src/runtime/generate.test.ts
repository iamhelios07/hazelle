import { beforeEach, describe, expect, it } from 'vitest';
import type { ModelSettings } from '../connectors/settings';
import type { Connection, Model, Starred } from '../connectors/types';
import { Credentials } from './credential';
import { generate } from './generate';
import { firstTurns } from '../model/turns';
import { stubRelay, testServer, upstream } from './testing';
import { streamKey } from '../vault/streams';

const model: Model = { id: 'm', name: 'm', input: null, output: null, contextLength: null, maxOutput: null, reasoning: null, tools: null, protocol: null, takes: { settings: null, reasoning: null } };
const openRouter: Connection = { type: 'openrouter', label: 'OpenRouter', baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'sk-or-x' }], turns: null, starred: [] };

const server = testServer();
beforeEach(() => server.account());

const answer = (status: number, body: string, headers: Record<string, string>) => stubRelay(() => new Response(body, { status, headers }));

async function run(connection = openRouter, target: Starred = model, credentials = new Credentials(), settings: ModelSettings = {}) {
  const texts: string[] = [];
  const key = await streamKey();
  const reply = await generate({
    credentials,
    connection,
    model: target,
    settings,
    messages: [{ role: 'user', content: '안녕' }],
    call: { id: crypto.randomUUID(), key: key.private, public: key.public },
    signal: new AbortController().signal,
    onText: (_, text) => texts.push(text),
  });
  return { reply, text: texts.join('') };
}

describe('generate', () => {
  it('sends the built request through the server’s stream and streams the reply', async () => {
    const log = answer(200, 'data: {"choices":[{"delta":{"content":"반가워요"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { 'x-relay': 'upstream' });
    const { reply, text } = await run();
    expect(text).toBe('반가워요');
    expect(reply).toMatchObject({ state: 'done', error: null, finishReason: 'stop' });
    expect(reply.firstTextMs).toBeGreaterThanOrEqual(0);
    expect(log[0]!.sent).toMatchObject({ url: 'https://openrouter.ai/api/v1/chat/completions', method: 'POST', headers: { authorization: 'Bearer sk-or-x' } });
  });

  it('reads an answer with no body as a stream that ended before its end marker', async () => {
    stubRelay(() => new Response(null, { status: 204, headers: { 'x-relay': 'upstream' } }));
    expect((await run()).reply).toMatchObject({ state: 'cut', cut: 'no-terminal', error: null });
  });

  it("tells the provider's refusal, the relay's and the app's apart", async () => {
    answer(401, '{"error":{"message":"No auth credentials found","code":401}}', { 'x-relay': 'upstream' });
    expect((await run()).reply).toMatchObject({ state: 'failed', error: { kind: 'provider', status: 401, detail: 'No auth credentials found' } });
    stubRelay(() => null);
    expect((await run()).reply).toMatchObject({ state: 'failed', error: { kind: 'relay', code: 'upstream-unreachable' } });
    await server.wipe();
    expect((await run()).reply).toMatchObject({ state: 'failed', error: { kind: 'app', code: 'no-session' } });
  });

  it('refuses before sending when the request cannot be built', async () => {
    const log = answer(200, '', { 'x-relay': 'upstream' });
    const anthropic: Connection = { ...openRouter, type: 'anthropic', accounts: [{ id: 'key', secret: 'sk-ant-x' }] };
    expect((await run(anthropic)).reply).toMatchObject({ state: 'failed', error: { kind: 'refused', code: 'max-tokens-unknown' } });
    expect((await run({ ...openRouter, type: 'someday' })).reply).toMatchObject({ error: { kind: 'refused', code: 'unknown-connection-type' } });
    expect(log).toEqual([]);
  });

  it('sends the 묶음’s settings, leaving out one the catalog says the model does not take', async () => {
    const log = answer(200, 'data: {"choices":[{"delta":{"content":"네"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { 'x-relay': 'upstream' });
    const listed: Starred = { ...model, takes: { settings: ['temperature'], reasoning: null } };
    await run(openRouter, listed, undefined, { temperature: 0.7, topP: 0.9 });
    expect(JSON.parse(log[0]!.sent.body!)).toMatchObject({ temperature: 0.7 });
    expect(JSON.parse(log[0]!.sent.body!)).not.toHaveProperty('top_p');
  });
});

describe('a connection that trades its key for a token', () => {
  const copilot: Connection = { type: 'copilot', label: 'Copilot', baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'gho_x', name: 'jin' }], turns: firstTurns('group', 'key'), starred: [] };
  const gpt: Model = { ...model, id: 'gpt-4.1' };
  const USER = 'https://api.github.com/copilot_internal/user';
  const EXCHANGE = 'https://api.github.com/copilot_internal/v2/token';
  const CHAT = 'https://api.githubcopilot.com/chat/completions';
  const unlimited = () => upstream(200, { quota_snapshots: { premium_interactions: { unlimited: true } } });

  function copilotApi(lasts: number) {
    const log = stubRelay(({ url }) =>
      url === USER
        ? unlimited()
        : url === EXCHANGE
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
    expect(sent().map((call) => call.url)).toEqual([USER, EXCHANGE, CHAT, CHAT]);
    expect(sent()[1]!.headers.authorization).toBe('Bearer gho_x');
    expect(sent()[2]!.headers.authorization).toBe('Bearer tid');

    const shortLived = copilotApi(30);
    const fresh = new Credentials();
    await run(copilot, gpt, fresh);
    await run(copilot, gpt, fresh);
    expect(shortLived().map((call) => call.url)).toEqual([USER, EXCHANGE, CHAT, EXCHANGE, CHAT]);
  });

  it('stops before the chat when the trade is refused', async () => {
    const log = stubRelay(({ url }) => (url === USER ? unlimited() : upstream(401, { message: 'Bad credentials' })));
    expect((await run(copilot, gpt)).reply).toMatchObject({ state: 'failed', error: { kind: 'provider', status: 401, detail: 'Bad credentials' } });
    expect(log.map((call) => call.sent.url)).toEqual([USER, EXCHANGE]);
  });

  it('refuses a model it cannot call before trading for a token', async () => {
    const log = answer(200, '', { 'x-relay': 'upstream' });
    expect((await run(copilot, { ...gpt, protocol: 'unsupported' })).reply).toMatchObject({ error: { kind: 'refused', code: 'unsupported-protocol' } });
    expect(log).toEqual([]);
  });
});
