import { ConnectorError, type ChatMessage, type Codec, type Modality } from './types';
import { count, isRecord } from './values';

const headers = (secret: string): Record<string, string> => ({ 'x-api-key': secret, 'anthropic-version': '2023-06-01' });

export const anthropicMessages: Codec = {
  authHeaders: headers,

  listModels: (endpoint, secret) => ({ url: `${endpoint.baseUrl}/models?limit=1000`, method: 'GET', headers: headers(secret), body: null }),

  // The Models API reports limits and image, PDF and thinking support. It does not report tool support.
  // A limit of 0 is read as unknown, as the API's own example shows 0 for real models.
  parseModels(payload) {
    if (!isRecord(payload) || !Array.isArray(payload.data)) return null;
    return payload.data
      .filter((raw): raw is Record<string, unknown> => isRecord(raw) && typeof raw.id === 'string' && raw.id !== '')
      .map((raw) => {
        const capabilities = isRecord(raw.capabilities) ? raw.capabilities : null;
        const supported = (name: string) => {
          const entry = capabilities?.[name];
          return isRecord(entry) && typeof entry.supported === 'boolean' ? entry.supported : null;
        };
        const input: Modality[] | null = capabilities
          ? ['text', ...(supported('image_input') ? (['image'] as const) : []), ...(supported('pdf_input') ? (['file'] as const) : [])]
          : null;
        return {
          id: raw.id as string,
          name: typeof raw.display_name === 'string' && raw.display_name ? raw.display_name : (raw.id as string),
          input,
          output: ['text'],
          contextLength: count(raw.max_input_tokens) || null,
          maxOutput: count(raw.max_tokens) || null,
          reasoning: supported('thinking'),
          tools: null,
        };
      });
  },

  // The Messages API requires max_tokens. With no request value and no catalog limit there is no
  // truthful number to send, so the request is refused instead of guessed.
  chat(endpoint, secret, { model, messages, maxTokens }) {
    const limit = maxTokens ?? model.maxOutput;
    if (limit === null) throw new ConnectorError('max-tokens-unknown');
    const system = messages.filter((message) => message.role === 'system').map((message) => message.content);
    return {
      url: `${endpoint.baseUrl}/messages`,
      method: 'POST',
      headers: { ...headers(secret), 'content-type': 'application/json' },
      body: JSON.stringify({
        model: model.id,
        max_tokens: limit,
        ...(system.length ? { system: system.join('\n\n') } : {}),
        messages: messages.filter((message): message is ChatMessage & { role: 'user' | 'assistant' } => message.role !== 'system'),
        stream: true,
      }),
    };
  },

  read(event, facts, append) {
    if (!isRecord(event)) return;
    if (event.type === 'message_start' && isRecord(event.message) && isRecord(event.message.usage)) {
      Object.assign(facts.rawUsage, event.message.usage);
    } else if (event.type === 'content_block_start' && isRecord(event.content_block)) {
      const block = event.content_block;
      if (block.type === 'text' && typeof block.text === 'string') append('text', block.text);
      if (block.type === 'thinking' && typeof block.thinking === 'string') append('reasoning', block.thinking);
    } else if (event.type === 'content_block_delta' && isRecord(event.delta)) {
      const delta = event.delta;
      if (delta.type === 'text_delta' && typeof delta.text === 'string') append('text', delta.text);
      if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') append('reasoning', delta.thinking);
    } else if (event.type === 'message_delta') {
      if (isRecord(event.delta) && typeof event.delta.stop_reason === 'string') facts.finishReason = event.delta.stop_reason;
      if (isRecord(event.usage)) Object.assign(facts.rawUsage, event.usage);
    }
  },

  terminal(event) {
    if (!isRecord(event)) return null;
    if (event.type === 'message_stop') return { state: 'completed' };
    if (event.type === 'error') {
      const error = isRecord(event.error) ? event.error : {};
      return { state: 'failed', error: typeof error.message === 'string' ? error.message : JSON.stringify(event.error) };
    }
    return null;
  },

  truncated: (finishReason) => finishReason === 'max_tokens',

  // input_tokens counts only the uncached part; cache reads and writes are added to get what was sent.
  usage(raw) {
    const uncached = count(raw.input_tokens);
    const cachedInputTokens = count(raw.cache_read_input_tokens);
    const cacheWriteInputTokens = count(raw.cache_creation_input_tokens);
    return {
      inputTokens: uncached === null ? null : uncached + (cachedInputTokens ?? 0) + (cacheWriteInputTokens ?? 0),
      cachedInputTokens,
      cacheWriteInputTokens,
      outputTokens: count(raw.output_tokens),
      reasoningTokens: null,
    };
  },
};
