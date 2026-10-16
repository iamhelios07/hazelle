import { openRouterModels } from './openrouter';
import type { ConnectionType } from './types';

export const surplus: ConnectionType = {
  id: 'surplus',
  label: 'Surplus Intelligence',
  group: 'gateway',
  description: '여러 판매자 중 가장 저렴한 곳에서 모델을 써요.',
  keyPage: 'https://www.surplusintelligence.ai/buy',
  endpoint: { baseUrl: 'https://api.surplusintelligence.ai/v1', protocol: 'chat-completions' },
  embeds: null,
  detect: { key: /^inf_/, host: 'api.surplusintelligence.ai' },
  // Its docs give its model list in OpenRouter's format.
  parseModels: openRouterModels,
};
