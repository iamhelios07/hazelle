import type { ConnectionType } from './types';

export const openai: ConnectionType = {
  id: 'openai',
  label: 'OpenAI',
  group: 'maker',
  major: true,
  description: 'OpenAI API로 GPT를 사용해요.',
  keyPage: 'https://platform.openai.com/api-keys',
  endpoint: { baseUrl: 'https://api.openai.com/v1', protocol: 'chat-completions' },
  detect: { key: /^sk-proj-/, host: 'api.openai.com' },
  outputLimit: (tokens) => ({ max_completion_tokens: tokens }),
  // Flex processing: billed at half of every rate, cached input too (OpenAI's pricing table, 2026-10-12). Only some models
  // take it and neither the model list nor models.dev says which, so it stays unknown; a model refusing it fails at the
  // provider, and one served another tier is priced at that tier.
  discount: { lane: 'tier', fields: { service_tier: 'flex' }, served: 'flex', accepted: null, rates: { input: 0.5, output: 0.5, cacheRead: 0.5, cacheWrite: 0.5 } },
};
