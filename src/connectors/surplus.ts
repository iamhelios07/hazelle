import { openRouterModels } from './openrouter';
import type { ConnectionType } from './types';

export const surplus: ConnectionType = {
  id: 'surplus',
  label: 'Surplus Intelligence',
  group: 'gateway',
  description: '여러 판매자 중 가장 저렴한 판매자로 모델을 호출해요.',
  keyPage: 'https://www.surplusintelligence.ai/buy',
  endpoint: { baseUrl: 'https://api.surplusintelligence.ai/v1', protocol: 'chat-completions' },
  detect: { key: /^inf_/, host: 'api.surplusintelligence.ai' },
  // Its docs give its model list in OpenRouter's format.
  parseModels: openRouterModels,
};
