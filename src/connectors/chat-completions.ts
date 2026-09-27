import type { Codec } from './types';
import { count, isRecord, list } from './values';

const bearer = (secret: string): Record<string, string> => (secret ? { authorization: `Bearer ${secret}` } : {});

// The OpenAI-compatible wire format, the generic base of design §4.
export const chatCompletions: Codec = {
  authHeaders: bearer,

  listModels: (endpoint, secret) => ({ url: `${endpoint.baseUrl}/models`, method: 'GET', headers: bearer(secret), body: null }),

  // The standard list names models and nothing else, so every capability stays unknown.
  parseModels(payload) {
    return list(isRecord(payload) ? payload.data : null)
      .filter((raw): raw is Record<string, unknown> => isRecord(raw) && typeof raw.id === 'string' && raw.id !== '')
      .map((raw) => ({
        id: raw.id as string,
        name: raw.id as string,
        input: null,
        output: null,
        contextLength: null,
        maxOutput: null,
        reasoning: null,
        tools: null,
      }));
  },

  // max_tokens is sent only when asked for: OpenAI's reasoning models refuse it in favor of
  // max_completion_tokens, which many compatible servers do not know.
  chat: (endpoint, secret, { model, messages, maxTokens }) => ({
    url: `${endpoint.baseUrl}/chat/completions`,
    method: 'POST',
    headers: { ...bearer(secret), 'content-type': 'application/json' },
    body: JSON.stringify({
      model: model.id,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(maxTokens === null ? {} : { max_tokens: maxTokens }),
    }),
  }),

  // reasoning_content (DeepSeek and others) and reasoning (OpenRouter) are the two spellings of
  // reasoning text in compatible streams. A server that sends neither is unaffected.
  read(event, facts, append) {
    if (!isRecord(event)) return;
    for (const choice of list(event.choices)) {
      if (!isRecord(choice)) continue;
      const delta = isRecord(choice.delta) ? choice.delta : {};
      const reasoning = typeof delta.reasoning_content === 'string' && delta.reasoning_content ? delta.reasoning_content : delta.reasoning;
      if (typeof reasoning === 'string') append('reasoning', reasoning);
      if (typeof delta.content === 'string') append('text', delta.content);
      if (typeof choice.finish_reason === 'string') facts.finishReason = choice.finish_reason;
    }
    if (isRecord(event.usage)) Object.assign(facts.rawUsage, event.usage);
  },

  terminal(event) {
    if (event === '[DONE]') return { state: 'completed' };
    if (isRecord(event) && event.error !== undefined && event.error !== null) return { state: 'failed', error: errorText(event.error) };
    return null;
  },

  truncated: (finishReason) => finishReason === 'length',

  usage(raw) {
    const prompt = isRecord(raw.prompt_tokens_details) ? raw.prompt_tokens_details : {};
    const completion = isRecord(raw.completion_tokens_details) ? raw.completion_tokens_details : {};
    return {
      inputTokens: count(raw.prompt_tokens),
      cachedInputTokens: count(prompt.cached_tokens),
      cacheWriteInputTokens: count(prompt.cache_write_tokens),
      outputTokens: count(raw.completion_tokens),
      reasoningTokens: count(completion.reasoning_tokens),
    };
  },
};

function errorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return JSON.stringify(error);
}
