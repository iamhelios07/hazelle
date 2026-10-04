import type { ConnectionType } from './types';

export const upstage: ConnectionType = {
  id: 'upstage',
  label: 'Upstage',
  group: 'maker',
  description: 'Solar를 만든 곳에 바로 연결해요.',
  keyPage: 'https://console.upstage.ai/api-keys',
  endpoint: { baseUrl: 'https://api.upstage.ai/v1', protocol: 'chat-completions' },
  detect: { key: /^up_/, host: 'api.upstage.ai' },
};
