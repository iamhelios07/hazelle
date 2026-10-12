import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelSettings } from '../connectors/settings';
import type { Connection, Model, Starred } from '../connectors/types';
import { Credentials } from './credential';
import { CANCEL, generate, resume } from './generate';
import type { ObjectStore } from './store';
import type { Stored } from '../model/kinds';
import { firstTurns } from '../model/turns';
import { saying, stubRelay, testServer, upstream } from './testing';
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

describe('a reply through a discount lane’s batch', () => {
  const anthropic: Connection = { ...openRouter, type: 'anthropic', accounts: [{ id: 'key', secret: 'sk-ant-x' }] };
  const claude: Starred = { ...model, maxOutput: 1000, price: { input: 2, output: 10, cacheRead: null, cacheWrite: null, tiers: [], asOf: 1 } };
  const BATCHES = 'https://api.anthropic.com/v1/messages/batches';
  const message = { id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'text', text: '반가워요' }], stop_reason: 'end_turn', usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } };
  const batch = (status: string) => upstream(200, { id: 'b1', type: 'message_batch', processing_status: status });

  // statuses: what each check answers, in turn.
  function provider(statuses: string[]) {
    let key = '';
    return stubRelay(({ url, body }) => {
      if (url === BATCHES) {
        key = (JSON.parse(body!) as { requests: { custom_id: string }[] }).requests[0]!.custom_id;
        return batch('in_progress');
      }
      if (url === `${BATCHES}/b1`) return batch(statuses.shift()!);
      if (url === `${BATCHES}/b1/results`) return new Response(JSON.stringify({ custom_id: key, result: { type: 'succeeded', message } }), { headers: { 'x-relay': 'upstream' } });
      if (url === `${BATCHES}/b1/cancel`) return batch('canceling');
      return saying('');
    });
  }

  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  async function ask(batching: boolean, abort = new AbortController()) {
    const key = await streamKey();
    const marked: (string | undefined)[] = [];
    let waited = false;
    const replying = generate({
      credentials: new Credentials(),
      connection: anthropic,
      model: claude,
      settings: { discount: true },
      messages: [{ role: 'user', content: '안녕' }],
      call: { id: crypto.randomUUID(), key: key.private, public: key.public, started: (id) => marked.push(id) },
      signal: abort.signal,
      onText: () => {},
      ...(batching && { batching: { waiting: () => (waited = true) } }),
    });
    let reply: Awaited<typeof replying> | null = null;
    void replying.then((done) => (reply = done));
    for (let tick = 0; tick < 20 && !reply; tick++) await vi.advanceTimersByTimeAsync(5_000);
    return { reply: reply!, marked, waited };
  }

  it('submits, waits through the relay, and prices the whole answer at the lane’s discount', async () => {
    const log = provider(['in_progress', 'ended']);
    const { reply, marked, waited } = await ask(true);
    expect(reply).toMatchObject({ state: 'done', error: null, discount: 'batch', cost: { amount: (2 + 10) / 2 } });
    expect(marked).toEqual(['b1']);
    expect(waited).toBe(true);
    expect(log.map(({ sent }) => sent.url)).toEqual([BATCHES, `${BATCHES}/b1`, `${BATCHES}/b1`, `${BATCHES}/b1/results`]);
    expect(log[0]!.sent.headers['x-api-key']).toBe('sk-ant-x');
    expect(JSON.parse(log[0]!.sent.body!).requests[0].params).not.toHaveProperty('stream');
  });

  it('never batches a call that may not wait for one, a task’s', async () => {
    const log = provider([]);
    const { reply } = await ask(false);
    expect(reply.discount).toBeUndefined();
    expect(log.map(({ sent }) => sent.url)).toEqual(['https://api.anthropic.com/v1/messages']);
    expect(JSON.parse(log[0]!.sent.body!)).toMatchObject({ stream: true });
  });

  it('asks about a batch its marker names after a reload, with the connection’s account, and reads its answer', async () => {
    const connection = { id: 'c', kind: 'connection', parent: null, rev: 1, value: { ...anthropic, starred: [claude] } };
    const store = { get: (kind: string, id: string) => (kind === 'connection' && id === 'c' ? connection : null) } as unknown as ObjectStore;
    const marker = { id: crypto.randomUUID(), kind: 'stream', parent: 'chat', rev: 1, value: { batch: 'b1', call: { connection: 'c', source: 'Anthropic', model: 'm', modelName: 'm' }, at: Date.now(), result: 'r', for: { kind: 'reply', message: null, replaces: null, continues: null } } } as Stored<'stream'>;
    // The results line is the marker's call's: the call's id was the batch request's key.
    const log = stubRelay(({ url }) => (url === `${BATCHES}/b1` ? batch('ended') : new Response(JSON.stringify({ custom_id: marker.id, result: { type: 'succeeded', message } }), { headers: { 'x-relay': 'upstream' } })));
    let reply: Awaited<ReturnType<typeof resume>> | null = null;
    void resume({ store, credentials: new Credentials() }, marker, new AbortController().signal, () => {}).then((done) => (reply = done));
    for (let tick = 0; tick < 5 && !reply; tick++) await vi.advanceTimersByTimeAsync(5_000);
    expect(reply).toMatchObject({ call: marker.id, state: 'done', discount: 'batch', firstTextMs: null, request: null });
    expect(log[0]!.sent.headers['x-api-key']).toBe('sk-ant-x');
  });

  it('cancels the batch at the provider on 멈추기, and only then', async () => {
    const log = provider(['in_progress', 'canceling']);
    const abort = new AbortController();
    setTimeout(() => abort.abort(CANCEL), 7_000);
    const { reply } = await ask(true, abort);
    expect(reply).toMatchObject({ state: 'cut', cut: 'stopped', error: null });
    expect(log.map(({ sent }) => sent.url)).toEqual([BATCHES, `${BATCHES}/b1`, `${BATCHES}/b1/cancel`, `${BATCHES}/b1`]);

    const kept = provider(['in_progress']);
    const closing = new AbortController();
    setTimeout(() => closing.abort(), 7_000);
    expect((await ask(true, closing)).reply).toMatchObject({ state: 'cut', cut: 'stopped' });
    expect(kept.map(({ sent }) => sent.url)).toEqual([BATCHES, `${BATCHES}/b1`]);
  });
});
