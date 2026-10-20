import type { ConnectionType } from './types';

// Its model list is public and answers any key, and its account lookup (POST /api/me) names the user
// without any usage, so a wrong key is caught by the first reply, as on a connection described by hand.
export const ollama: ConnectionType = {
  browser: false,
  id: 'ollama',
  label: 'Ollama Cloud',
  group: 'gateway',
  description: '여러 회사의 공개 모델을 Ollama 서버에서 실행해요.',
  keyPage: 'https://ollama.com/settings/keys',
  endpoint: { baseUrl: 'https://ollama.com/v1', protocol: 'chat-completions' },
  embeds: null,
  detect: { key: null, host: 'ollama.com' },
  // No usage API and no rate-limit headers (checked with a real key, 2026-10-04): this page is all there is.
  usagePage: 'https://ollama.com/settings/usage',
};
