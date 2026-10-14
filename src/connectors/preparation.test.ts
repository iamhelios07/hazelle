import { expect, it } from 'vitest';
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';
import { contextRefusal, prepareChat } from './preparation';
import { resolveConnection, type Route } from './registry';
import type { ChatMessage, Connection, Model, Protocol } from './types';

const model: Model = { id: 'opaque-id', name: 'arbitrary name', input: ['text', 'image'], output: ['text'], contextLength: 10000, maxOutput: 100, reasoning: null, tools: null, protocol: null, takes: { settings: null, reasoning: null } };
const connection = (protocol: Protocol): Connection => ({ type: 'generic', label: '', baseUrl: 'https://example.test', protocol, accounts: [], turns: null, starred: [] });
const route = (protocol: Protocol) => resolveConnection(connection(protocol)) as Route;
const messages: ChatMessage[] = [{ role: 'system', content: '첫 지시' }, { role: 'system', content: '다음 지시', cache: true }, { role: 'user', content: '질문', pictures: [{ type: 'image/png', data: 'BASE64_NOT_TEXT' }] }, { role: 'user', content: '계속' }];

it('measures the exact built text segments after joining, cache splits, role remapping and same-role merging', () => {
  const anthropic = prepareChat(route('anthropic-messages'), { model, messages, settings: { cache: '5m' } });
  expect(anthropic.wire).toEqual({ segments: [{ role: 'system', text: '첫 지시\n\n다음 지시' }, { role: 'user', text: '질문' }, { role: 'user', text: '계속' }], messages: 3, pictures: 1 });
  const split = prepareChat(route('anthropic-messages'), { model, messages: messages.map((message) => ({ ...message, cache: true })), settings: { cache: '5m' } });
  expect(split.wire.segments.slice(0, 2).map(({ text }) => text)).toEqual(['첫 지시', '\n\n다음 지시']);
  const gemini = prepareChat(route('gemini'), { model, messages, settings: {} });
  expect(gemini.wire).toEqual({ ...anthropic.wire, messages: 2 });
  for (const protocol of ['chat-completions', 'responses', 'anthropic-messages', 'gemini'] as const) {
    const sent = prepareChat(route(protocol), { model, messages, settings: { systemAsUser: true } });
    expect(sent.wire.segments.map(({ role }) => role)).toEqual(['user', 'user', 'user', 'user']);
    expect(sent.wire.segments.reduce((sum, { text }) => sum + countTokens(text), 0)).toBe(messages.reduce((sum, { content }) => sum + countTokens(content), 0));
    expect(sent.wire.pictures).toBe(1);
    expect(sent.request.body).toContain('BASE64_NOT_TEXT');
    expect(sent.wire.segments.some(({ text }) => text.includes('BASE64'))).toBe(false);
  }
});

it('keys the actual route and configuration, not the prompt, display name or cache fingerprint', () => {
  const prepared = (over: Partial<Parameters<typeof prepareChat>[1]>) => prepareChat(route('responses'), { model, messages, settings: { cache: '5m' }, ...over });
  const first = prepared({});
  expect(prepared({ messages: [], model: { ...model, name: 'renamed' } }).identity).toBe(first.identity);
  expect(prepared({ settings: { systemAsUser: true } }).identity).not.toBe(first.identity);
  expect(prepared({ settings: { reasoning: { kind: 'level', level: 'high' } } }).identity).not.toBe(first.identity);
});

it('recognizes only context refusals and never mistakes a total requested count for exact input', () => {
  expect(contextRefusal('anthropic-messages', { status: 400, detail: 'prompt is too long: 210,000 tokens > 200,000 maximum' })).toEqual({ actual: 210000, maximum: 200000 });
  expect(contextRefusal('gemini', { status: 400, detail: 'The input token count (1048577) exceeds the maximum number of tokens allowed (1048576).' })).toEqual({ actual: 1048577, maximum: 1048576 });
  for (const protocol of ['responses', 'chat-completions']) expect(contextRefusal(protocol, { status: 400, code: 'context_length_exceeded', detail: 'maximum context length 1000; requested 1200 tokens including 100 completion tokens' })).toEqual({ actual: null, maximum: null });
  expect(contextRefusal('chat-completions', { status: 429, code: 'context_length_exceeded', detail: '' })).toBeNull();
  expect(contextRefusal('anthropic-messages', { status: 400, detail: 'max_tokens must be greater than thinking.budget_tokens' })).toBeNull();
});
