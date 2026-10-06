import type { ConnectionType } from './types';

export const cerebras: ConnectionType = {
  id: 'cerebras',
  label: 'Cerebras',
  group: 'gateway',
  description: '여러 회사의 공개 모델을 Cerebras 서버에서 실행해요.',
  keyPage: 'https://cloud.cerebras.ai',
  endpoint: { baseUrl: 'https://api.cerebras.ai/v1', protocol: 'chat-completions' },
  detect: { key: /^csk-/, host: 'api.cerebras.ai' },
};
