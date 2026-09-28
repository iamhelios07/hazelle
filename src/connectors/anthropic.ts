import type { ConnectionType } from './types';

export const anthropic: ConnectionType = {
  id: 'anthropic',
  label: 'Anthropic',
  group: 'maker',
  description: 'Claude를 만든 곳에 바로 연결해요.',
  keyPage: 'https://console.anthropic.com/settings/keys',
  endpoint: { baseUrl: 'https://api.anthropic.com/v1', protocol: 'anthropic-messages' },
  detect: { key: /^sk-ant-/, host: 'api.anthropic.com' },
};
