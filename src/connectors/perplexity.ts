import type { ConnectionType } from './types';

export const perplexity: ConnectionType = {
  browser: {},
  id: 'perplexity',
  label: 'Perplexity',
  group: 'gateway',
  description: '여러 회사의 모델을 Perplexity 키 하나로 써요.',
  keyPage: 'https://console.perplexity.ai/project/keys',
  // The Router: its OpenAI-compatible chat and model list both live under /router/v1. The Sonar API at the bare host
  // has no model list.
  endpoint: { baseUrl: 'https://api.perplexity.ai/router/v1', protocol: 'chat-completions' },
  embeds: null,
  detect: { key: /^pplx-/, host: 'api.perplexity.ai' },
};
