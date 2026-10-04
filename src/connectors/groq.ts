import { bareModel } from './chat-completions';
import type { ConnectionType } from './types';
import { count, modelEntries } from './values';

export const groq: ConnectionType = {
  id: 'groq',
  label: 'Groq',
  group: 'gateway',
  description: '여러 회사의 공개 모델을 Groq 서버에서 돌려요.',
  keyPage: 'https://console.groq.com/keys',
  endpoint: { baseUrl: 'https://api.groq.com/openai/v1', protocol: 'chat-completions' },
  detect: { key: /^gsk_/, host: 'api.groq.com' },
  parseModels: (payload) => modelEntries(payload)?.map((raw) => ({ ...bareModel(raw.id), contextLength: count(raw.context_window) })) ?? null,
};
