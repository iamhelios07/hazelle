import type { ConnectionType } from './types';

export const anthropic: ConnectionType = {
  id: 'anthropic',
  label: 'Anthropic',
  endpoint: { baseUrl: 'https://api.anthropic.com/v1', protocol: 'anthropic-messages' },
  detect: { key: /^sk-ant-/, host: 'api.anthropic.com' },
};
