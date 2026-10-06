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
};
