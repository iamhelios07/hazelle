import { describe, expect, it } from 'vitest';
import recorded from './fixtures/gemini.json';
import { chatRequest, detect, parseCatalog, resolveConnection, withCredential, type Resolved } from './registry';
import { decodeStream } from './stream';
import type { Phase } from './types';

const google: Resolved = resolveConnection({ type: 'google', label: 'Google', baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'key' }], turns: null, starred: [] })!;
const [flash, old] = parseCatalog(google, recorded.models)!;

async function decode(text: string, media = 'text/event-stream') {
  const parts: [Phase, string][] = [];
  const response = new Response(text, { headers: { 'content-type': media } });
  const outcome = await decodeStream(google, flash!, response, new AbortController().signal, (phase, chunk) => parts.push([phase, chunk]));
  const joined = (phase: Phase) => parts.filter(([p]) => p === phase).map(([, chunk]) => chunk).join('');
  return { outcome, text: joined('text'), reasoning: joined('reasoning') };
}

const sse = (...events: unknown[]) => events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');

describe('Gemini', () => {
  it('is found by its key and lists only models that generate content', () => {
    expect(detect(`AIza${'x'.repeat(35)}`)).toMatchObject({ kind: 'key', type: { id: 'google' } });
    expect(parseCatalog(google, recorded.models)!.map((model) => model.id)).toEqual(['gemini-3.5-flash', 'gemini-2.0-flash']);
    expect(flash).toMatchObject({ name: 'Gemini 3.5 Flash', contextLength: 1048576, maxOutput: 65536, reasoning: true });
    expect(old!.reasoning).toBe(false);
  });

  it('sends system apart, one turn per run of a role, and thinking with its thoughts', () => {
    const request = withCredential(google, chatRequest(google, {
      model: flash!,
      messages: [
        { role: 'system', content: '규칙' },
        { role: 'assistant', content: '어서 와.' },
        { role: 'system', content: '기억' },
        { role: 'user', content: '안녕' },
        { role: 'user', content: '뭐 해?' },
      ],
      settings: { maxOutput: 1000, topK: 40, stop: ['끝'], reasoning: { kind: 'level', level: 'low' } },
    }), 'secret');
    expect(request.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse');
    expect(request.headers['x-goog-api-key']).toBe('secret');
    expect(JSON.parse(request.body!)).toEqual({
      systemInstruction: { parts: [{ text: '규칙\n\n기억' }] },
      contents: [
        { role: 'model', parts: [{ text: '어서 와.' }] },
        { role: 'user', parts: [{ text: '안녕' }, { text: '뭐 해?' }] },
      ],
      generationConfig: { maxOutputTokens: 1000, topK: 40, stopSequences: ['끝'], thinkingConfig: { thinkingLevel: 'low', includeThoughts: true } },
    });
    const plain = chatRequest(google, { model: old!, messages: [{ role: 'user', content: '안녕' }], settings: { streaming: false } });
    expect(plain.url).toMatch(/gemini-2\.0-flash:generateContent$/);
    expect(JSON.parse(plain.body!)).toEqual({ contents: [{ role: 'user', parts: [{ text: '안녕' }] }] });
  });

  it('reads thoughts apart from the text, and usage with thoughts in the output', async () => {
    const { outcome, text, reasoning } = await decode(sse(...recorded.stream));
    expect({ text, reasoning }).toEqual({ text: '안녕하세요!', reasoning: '짧게 답하자.' });
    expect(outcome).toMatchObject({ state: 'done', replyId: 'mFLhaOirDu2qz7IPzN7DqQg' });
    expect(outcome.usage).toEqual({ inputTokens: 120, cachedInputTokens: 100, cacheWriteInputTokens: null, outputTokens: 20, reasoningTokens: 16 });
  });

  it('cuts at MAX_TOKENS and fails a refused or blocked reply', async () => {
    expect((await decode(sse(recorded.cut))).outcome).toMatchObject({ state: 'cut', cut: 'length' });
    expect((await decode(JSON.stringify(recorded.blocked), 'application/json')).outcome).toMatchObject({ state: 'failed', error: { kind: 'provider', detail: 'PROHIBITED_CONTENT' } });
    const safety = { candidates: [{ content: { parts: [], role: 'model' }, finishReason: 'SAFETY', finishMessage: 'blocked' }] };
    expect((await decode(sse(safety))).outcome).toMatchObject({ state: 'failed', error: { detail: 'SAFETY: blocked' } });
    expect((await decode(sse(recorded.error))).outcome).toMatchObject({ state: 'failed', error: { kind: 'provider', detail: 'Resource has been exhausted (e.g. check quota).' } });
  });
});
