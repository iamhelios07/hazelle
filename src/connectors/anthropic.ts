import type { ConnectionType } from './types';

export const anthropic: ConnectionType = {
  id: 'anthropic',
  label: 'Anthropic',
  group: 'maker',
  major: true,
  description: 'Anthropic API로 Claude를 사용해요.',
  keyPage: 'https://console.anthropic.com/settings/keys',
  endpoint: { baseUrl: 'https://api.anthropic.com/v1', protocol: 'anthropic-messages' },
  detect: { key: /^sk-ant-/, host: 'api.anthropic.com' },
};
