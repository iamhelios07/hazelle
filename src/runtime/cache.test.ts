import { describe, expect, it } from 'vitest';
import type { CacheFacts } from '../connectors/registry';
import type { Message, Receipt } from '../model/chat';
import type { Role } from '../model/prompt';
import { forecast, lastCache, type CacheSend, type Prior } from './cache';

// Each message counts 10 tokens and is named by its text, which is its hash; a trailing ✓ puts a cache point after it.
const send = (texts: string[], over: { connection?: string; account?: string | null; model?: string; facts?: CacheFacts } = {}): CacheSend => ({
  connection: over.connection ?? 'c1',
  account: over.account === undefined ? 'a1' : over.account,
  model: over.model ?? 'm1',
  messages: texts.map((text) => {
    const name = text.replace(' ✓', '');
    return { role: (text.startsWith('sys') ? 'system' : 'user') as Role, hash: name, tokens: 10, from: { kind: 'block', name, slot: null }, ...(text.endsWith('✓') && { point: true as const }) };
  }),
  facts: over.facts ?? null,
});
const before = (texts: string[], live = true): Prior => {
  const { connection, account, model, messages } = send(texts);
  return { print: { call: 'call', connection, account, model, messages }, live };
};
const from = (name: string) => ({ kind: 'block', name, slot: null });

describe('forecast', () => {
  const last = before(['sys ✓', 'u1', 'a1 ✓']);

  it('reads all the last call cached when the next send only adds after it, and writes up to its own last point', () => {
    expect(forecast(last, send(['sys ✓', 'u1', 'a1 ✓', 'u2 ✓', 'note']))).toMatchObject({ against: { read: 30, of: 30, broken: null }, written: 10, tail: 10, removed: [] });
  });

  it('reads nothing when another account of the connection would send it, and claims no change when the next is unknown', () => {
    expect(forecast(last, send(['sys ✓', 'u1', 'a1 ✓', 'u2 ✓'], { account: 'a2' }))?.against?.broken).toEqual({ kind: 'account' });
    expect(forecast(last, send(['sys ✓', 'u1', 'a1 ✓', 'u2 ✓'], { account: null }))?.against?.broken).toBeNull();
  });

  it('names a message put in before the cached chat, and reads up to the point before it', () => {
    expect(forecast(last, send(['sys ✓', 'lore', 'u1', 'a1 ✓', 'u2 ✓']))?.against).toEqual({ read: 10, of: 30, broken: { kind: 'added', from: from('lore'), role: 'user' } });
  });

  it('names a message the last call sent and the next drops, as the budget drops the oldest', () => {
    expect(forecast(last, send(['sys ✓', 'a1', 'u2 ✓']))?.against?.broken).toEqual({ kind: 'removed', from: from('u1'), role: 'user' });
  });

  it('reads nothing on another model, or once the time is up', () => {
    expect(forecast(last, send(['sys ✓', 'u1', 'a1 ✓'], { model: 'm2' }))?.against).toEqual({ read: 0, of: 30, broken: { kind: 'model' } });
    expect(forecast(before(['sys ✓', 'u1', 'a1 ✓'], false), send(['sys ✓', 'u1', 'a1 ✓', 'u2 ✓']))?.against?.broken).toEqual({ kind: 'expired' });
  });

  it('lists every part that differs in wire order, a changed one beside what it replaces, with each part read, written or left out', () => {
    const next: CacheSend = send(['sys ✓', 'lore', 'u1', 'a1', 'u2 ✓', 'tail']);
    next.messages[0] = { ...next.messages[0]!, hash: 'sys edited' };
    const made = forecast(before(['sys ✓', 'gone', 'u1', 'a1 ✓']), next)!;
    expect(made.against).toEqual({ read: 0, of: 40, broken: { kind: 'changed', from: from('sys'), role: 'system' } });
    expect(made.parts.map(({ state, change, point }) => [state, change, point])).toEqual([
      ['write', 'changed', 'cache'],
      ['write', 'added', null],
      ['write', null, null],
      ['write', null, null],
      ['write', null, 'cache'],
      ['tail', null, null],
    ]);
    expect(made.removed).toEqual([{ role: 'user', from: from('gone'), tokens: 10 }]);
    expect([made.written, made.tail]).toEqual([50, 10]);
  });

  it('pairs a changed part with its last version though a print stored before ids were kept has none', () => {
    const next = send(['sys ✓', 'u1', 'a1 ✓']);
    next.messages = next.messages.map((message) => ({ ...message, from: { ...message.from, id: 'block' } }));
    next.messages[0] = { ...next.messages[0]!, hash: 'sys edited' };
    expect(forecast(last, next)?.against?.broken).toMatchObject({ kind: 'changed' });
  });

  it("leaves out a point under the model's minimum, and reads nothing past the provider's lookback", () => {
    const facts = { minimum: 25, lookback: 2 };
    const short = forecast(before(['sys ✓', 'u1', 'a1 ✓']), send(['sys ✓', 'u1', 'a1 ✓', 'u2 ✓'], { facts }))!;
    expect(short.against).toEqual({ read: 30, of: 30, broken: null });
    expect(short.parts[0]!.point).toBe('short');
    const far = forecast(before(['sys ✓', 'u1', 'a1 ✓']), send(['sys ✓', 'u1', 'a1', 'l1', 'l2', 'u2 ✓'], { facts }))!;
    expect(far.against).toEqual({ read: 0, of: 30, broken: { kind: 'far' } });
  });
});

describe('lastCache', () => {
  const receipt = (over: Partial<Receipt>): Receipt => ({
    id: 'call', connection: 'c1', source: 'S', model: 'm1', modelName: 'M', state: 'done', cut: null, error: null, finishReason: 'stop', cost: null, replyId: null, firstTextMs: 100,
    usage: { inputTokens: 1000, outputTokens: 10, reasoningTokens: null, cachedInputTokens: 0, cacheWriteInputTokens: 900 }, totalMs: 4000, cache: '5m', ...over,
  });
  const reply = (at: number, value: Receipt): Message => ({ id: `m${at}`, role: 'assistant', at, versions: [{ id: `v${at}`, seed: 's', text: 't', receipt: value, edited: false, at }], selected: 0 });

  it('keeps what the latest call cached for its TTL from the call’s start, and nothing when it cached none', () => {
    expect(lastCache([reply(10_000, receipt({ cache: '1h' })), reply(20_000, receipt({}))])).toEqual({ call: 'call', until: 16_000 + 300_000 });
    expect(lastCache([reply(10_000, receipt({})), reply(20_000, receipt({ usage: { inputTokens: 100, outputTokens: 1, reasoningTokens: null, cachedInputTokens: 0, cacheWriteInputTokens: 0 } }))])).toBeNull();
  });
});
