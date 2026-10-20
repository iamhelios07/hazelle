import type { ConnectionType } from './types';

export const upstage: ConnectionType = {
  browser: {},
  id: 'upstage',
  label: 'Upstage',
  group: 'maker',
  description: 'Upstage API로 Solar를 써요.',
  keyPage: 'https://console.upstage.ai/api-keys',
  endpoint: { baseUrl: 'https://api.upstage.ai/v1', protocol: 'chat-completions' },
  detect: { key: /^up_/, host: 'api.upstage.ai' },
};
