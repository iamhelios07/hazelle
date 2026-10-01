import type { NumberSetting, Reasoning, Setting } from './settings';
import { wireMessage } from './anthropic-messages';
import type { Codec } from './types';
import { count, isRecord, list, modelEntries } from './values';

// This format's field for each setting it carries. OpenRouter's and Vercel's catalogs name the same
// fields in supported_parameters. max_tokens rather than max_completion_tokens: OpenAI's reasoning
// models refuse the first in favor of the second, which many compatible servers do not know.
const FIELDS: Record<NumberSetting | 'stop', string> = {
  maxOutput: 'max_tokens',
  temperature: 'temperature',
  topP: 'top_p',
  topK: 'top_k',
  frequencyPenalty: 'frequency_penalty',
  presencePenalty: 'presence_penalty',
  repetitionPenalty: 'repetition_penalty',
  minP: 'min_p',
  seed: 'seed',
  stop: 'stop',
};
const CARRIED = Object.keys(FIELDS) as (keyof typeof FIELDS)[];

export function listedSettings(names: unknown[]): Setting[] {
  const settings: Setting[] = CARRIED.filter((setting) => names.includes(FIELDS[setting]));
  return names.includes('reasoning') || names.includes('reasoning_effort') ? [...settings, 'reasoning'] : settings;
}

// OpenAI's reasoning_effort, which OpenRouter and Vercel take too; 'none' turns reasoning off.
function effort(reasoning: Reasoning | undefined) {
  if (reasoning?.kind === 'level') return { reasoning_effort: reasoning.level };
  if (reasoning?.kind === 'off') return { reasoning_effort: 'none' };
  return {};
}

// The OpenAI-compatible wire format, the generic base every connection type builds on.
export const chatCompletions: Codec = {
  authHeaders: (secret): Record<string, string> => (secret ? { authorization: `Bearer ${secret}` } : {}),

  listModels: (endpoint) => ({ url: `${endpoint.baseUrl}/models`, method: 'GET', headers: {}, body: null }),

  systemFirst: false,

  // The standard list names models and nothing else, so every capability stays unknown.
  parseModels: (payload) =>
    modelEntries(payload)?.map(({ id }) => ({
      id,
      name: id,
      input: null,
      output: null,
      contextLength: null,
      maxOutput: null,
      reasoning: null,
      tools: null,
      protocol: null,
    })) ?? null,

  // top_k, min_p and repetition_penalty are not OpenAI's, but vLLM and OpenRouter take them.
  carries: {
    numbers: {
      maxOutput: { min: 1, max: null },
      temperature: { min: 0, max: 2 },
      topP: { min: 0, max: 1 },
      topK: { min: 0, max: null },
      frequencyPenalty: { min: -2, max: 2 },
      presencePenalty: { min: -2, max: 2 },
      repetitionPenalty: { min: 0, max: 2 },
      minP: { min: 0, max: 1 },
      seed: { min: null, max: null },
    },
    reasoning: { off: true, levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], budget: null, adaptive: false },
    // The standard has no cache points; a connection type whose provider reads cache_control says so.
    cache: false,
  },

  chat: (endpoint, { model, messages, settings }, fields) => ({
    url: `${endpoint.baseUrl}/chat/completions`,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: model.id,
      messages: messages.map((message) => wireMessage(message, settings.cache)),
      stream: true,
      stream_options: { include_usage: true },
      ...Object.fromEntries(CARRIED.filter((setting) => settings[setting] !== undefined).map((setting) => [FIELDS[setting], settings[setting]])),
      ...effort(settings.reasoning),
      ...fields,
    }),
  }),

  // reasoning_content (DeepSeek and others) and reasoning (OpenRouter) are the two spellings of
  // reasoning text in compatible streams. A server that sends neither is unaffected.
  read(event, facts, append) {
    if (!isRecord(event)) return;
    if (typeof event.id === 'string' && event.id) facts.id ??= event.id;
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
