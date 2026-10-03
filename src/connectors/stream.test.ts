import { describe, expect, it } from 'vitest';
import { resolveConnection, type Resolved } from './registry';
import { decodeStream } from './stream';
import type { Connection, Model, Phase } from './types';

const connection = (type: string, extra: Partial<Connection> = {}): Resolved =>
  resolveConnection({ type, label: type, baseUrl: null, protocol: null, secret: 'key', starred: [], ...extra })!;

const openRouter = connection('openrouter');
const anthropic = connection('anthropic');
const model: Model = { id: 'm', name: 'm', input: null, output: null, contextLength: null, maxOutput: null, reasoning: null, tools: null, protocol: null, takes: { settings: null, reasoning: null } };

// Chunks are cut at awkward places on purpose: inside a line and inside a multi-byte character.
function body(text: string, cuts = 7): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  const size = Math.ceil(bytes.length / cuts);
  return new ReadableStream({
    start(controller) {
      for (let at = 0; at < bytes.length; at += size) controller.enqueue(bytes.slice(at, at + size));
      controller.close();
    },
  });
}

async function decode(resolved: Resolved, stream: ReadableStream<Uint8Array>, controller = new AbortController()) {
  const parts: [Phase, string][] = [];
  const outcome = await decodeStream(resolved, model, stream, controller.signal, (phase, text) => parts.push([phase, text]));
  const joined = (phase: Phase) => parts.filter(([p]) => p === phase).map(([, text]) => text).join('');
  return { outcome, text: joined('text'), reasoning: joined('reasoning') };
}

const sse = (...events: unknown[]) => events.map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join('');
const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({ choices: [{ index: 0, delta, finish_reason: finish }] });

describe('chat completions stream', () => {
  it('reads reasoning, text, usage and OpenRouter cost, and skips keep-alive comments', async () => {
    const stream =
      ': OPENROUTER PROCESSING\n\n' +
      sse(
        chunk({ role: 'assistant', reasoning: '인사를 ' }),
        chunk({ reasoning: '생각해요.' }),
        chunk({ content: '안녕하세요, ' }),
        chunk({ content: '반가워요!' }),
        chunk({}, 'stop'),
        {
          choices: [],
          usage: { prompt_tokens: 12, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 8 }, cost: 0.00042 },
        },
        '[DONE]',
      );
    expect(await decode(openRouter, body(stream))).toEqual({
      text: '안녕하세요, 반가워요!',
      reasoning: '인사를 생각해요.',
      outcome: {
        state: 'done',
        cut: null,
        error: null,
        finishReason: 'stop',
        usage: { inputTokens: 12, cachedInputTokens: 0, cacheWriteInputTokens: null, outputTokens: 20, reasoningTokens: 8 },
        cost: { unit: 'usd', amount: 0.00042, source: 'reported' },
        replyId: null,
      },
    });
  });

  it('leaves a cost the provider books later pending, with the id to look it up by', async () => {
    const stream = sse({ id: 'gen_01K', ...chunk({ content: '안녕' }) }, { id: 'gen_01K', ...chunk({}, 'stop') }, '[DONE]');
    const { outcome } = await decode(connection('vercel'), body(stream));
    expect(outcome).toMatchObject({ state: 'done', cost: 'pending', replyId: 'gen_01K' });
  });

  it('marks a reply that hit the token limit as cut', async () => {
    const { outcome, text } = await decode(openRouter, body(sse(chunk({ content: '길게 이어지다' }), chunk({}, 'length'), '[DONE]')));
    expect(text).toBe('길게 이어지다');
    expect(outcome).toMatchObject({ state: 'cut', cut: 'length', finishReason: 'length', usage: null, cost: null });
  });

  it('marks a stream that ends without a finish reason or end marker as cut, and one with a finish reason as done', async () => {
    expect((await decode(openRouter, body(sse(chunk({ content: '중간에' }))))).outcome).toMatchObject({ state: 'cut', cut: 'no-terminal' });
    expect((await decode(openRouter, body(sse(chunk({ content: '끝' }, 'stop'))))).outcome).toMatchObject({ state: 'done' });
  });

  it("fails on the provider's mid-stream error and on an event that is not JSON", async () => {
    const error = { error: { code: 502, message: 'Provider returned error' }, choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }] };
    expect((await decode(openRouter, body(sse(chunk({ content: '앞부분' }), error)))).outcome).toMatchObject({
      state: 'failed',
      error: { kind: 'provider', detail: 'Provider returned error' },
    });
    expect((await decode(openRouter, body('data: {not json\n\n'))).outcome).toMatchObject({ state: 'failed', error: { kind: 'bad-event', detail: '{not json' } });
  });

  it('keeps what arrived and marks the reply as stopped when the reader is aborted', async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new TextEncoder().encode(sse(chunk({ content: '여기까지' }))));
        controller.signal.addEventListener('abort', () => stream.error(new DOMException('aborted', 'AbortError')));
      },
    });
    const decoding = decode(openRouter, stream, controller);
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    expect(await decoding).toMatchObject({ text: '여기까지', outcome: { state: 'cut', cut: 'stopped' } });
  });
});

describe('anthropic messages stream', () => {
  const start = { type: 'message_start', message: { usage: { input_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, output_tokens: 1 } } };

  it('reads thinking and text blocks, sums cached input, and ends on message_stop', async () => {
    const stream = sse(
      start,
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '짧게 답하자.' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'ping' },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '안녕하세요!' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 15 } },
      { type: 'message_stop' },
    );
    expect(await decode(anthropic, body(stream))).toEqual({
      text: '안녕하세요!',
      reasoning: '짧게 답하자.',
      outcome: {
        state: 'done',
        cut: null,
        error: null,
        finishReason: 'end_turn',
        usage: { inputTokens: 125, cachedInputTokens: 100, cacheWriteInputTokens: 20, outputTokens: 15, reasoningTokens: null },
        cost: null,
        replyId: null,
      },
    });
  });

  it('marks max_tokens as cut and an error event as failed', async () => {
    const truncated = sse(start, { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 9 } }, { type: 'message_stop' });
    expect((await decode(anthropic, body(truncated))).outcome).toMatchObject({ state: 'cut', cut: 'length' });
    const failed = sse(start, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });
    expect((await decode(anthropic, body(failed))).outcome).toMatchObject({ state: 'failed', error: { kind: 'provider', detail: 'Overloaded' } });
  });
});
