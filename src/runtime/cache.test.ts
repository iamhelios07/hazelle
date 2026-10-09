import { describe, expect, it } from 'vitest';
import type { Message, Receipt } from '../model/chat';
import type { Role } from '../model/prompt';
import { forecast, lastCache, type CacheSend } from './cache';

// Each message counts 10 tokens and is named by its text; a trailing ✓ puts a cache point after it.
const send = (texts: string[], over: { connection?: string; account?: string | null; model?: string } = {}): CacheSend => {
  const messages = texts.map((text, index) => ({ role: (text.startsWith('sys') ? 'system' : 'user') as Role, content: text.replace(' ✓', ''), index, ...(text.endsWith('✓') && { cache: true as const }) }));
  return {
    connection: over.connection ?? 'c1',
    account: over.account === undefined ? 'a1' : over.account,
    view: { model: over.model ?? 'm1', reasoning: undefined, cache: '5m', messages },
    parts: messages.map(({ content }) => ({ from: { kind: 'block', name: content, slot: null }, tokens: 10 })),
  };
};

describe('forecast', () => {
  const last = send(['sys ✓', 'u1', 'a1 ✓']);

  it('reads all the last call cached when the next send only adds after it', () => {
    expect(forecast(last, send(['sys ✓', 'u1', 'a1 ✓', 'u2 ✓']))).toEqual({ read: 30, of: 30, broken: null });
  });

  it('reads nothing when another account of the connection would send it, and claims no change when the next is unknown', () => {
    expect(forecast(last, send(['sys ✓', 'u1', 'a1 ✓', 'u2 ✓'], { account: 'a2' }))?.broken).toEqual({ kind: 'account' });
    expect(forecast(last, send(['sys ✓', 'u1', 'a1 ✓', 'u2 ✓'], { account: null }))?.broken).toBeNull();
  });

  it('names a message put in before the cached chat, and reads up to the point before it', () => {
    expect(forecast(last, send(['sys ✓', 'lore', 'u1', 'a1 ✓', 'u2 ✓']))).toEqual({ read: 10, of: 30, broken: { kind: 'added', from: { kind: 'block', name: 'lore', slot: null }, role: 'user' } });
  });

  it('names a message the last call sent and the next drops, as the budget drops the oldest', () => {
    expect(forecast(last, send(['sys ✓', 'a1', 'u2 ✓']))?.broken).toEqual({ kind: 'differs', from: { kind: 'block', name: 'u1', slot: null }, role: 'user' });
  });

  it('reads nothing on another model', () => {
    expect(forecast(last, send(['sys ✓', 'u1', 'a1 ✓'], { model: 'm2' }))).toEqual({ read: 0, of: 30, broken: { kind: 'model' } });
  });
});

describe('lastCache', () => {
  const receipt = (over: Partial<Receipt>): Receipt => ({
    id: 'call', connection: 'c1', source: 'S', model: 'm1', modelName: 'M', state: 'done', cut: null, error: null, finishReason: 'stop', cost: null, replyId: null, firstTextMs: 100,
    usage: { inputTokens: 1000, outputTokens: 10, reasoningTokens: null, cachedInputTokens: 0, cacheWriteInputTokens: 900 }, totalMs: 4000, cache: '5m', ...over,
  });
  const reply = (at: number, value: Receipt): Message => ({ id: `m${at}`, role: 'assistant', at, versions: [{ id: `v${at}`, seed: 's', text: 't', receipt: value, edited: false, at }], selected: 0 });

  it('keeps what the latest call cached for its TTL from the call’s start, and nothing when it cached none', () => {
    expect(lastCache([reply(10_000, receipt({ cache: '1h' })), reply(20_000, receipt({}))])).toEqual({ call: 'call', connection: 'c1', account: null, until: 16_000 + 300_000 });
    expect(lastCache([reply(10_000, receipt({})), reply(20_000, receipt({ usage: { inputTokens: 100, outputTokens: 1, reasoningTokens: null, cachedInputTokens: 0, cacheWriteInputTokens: 0 } }))])).toBeNull();
  });
});
