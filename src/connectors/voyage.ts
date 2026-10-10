import { bareModel } from './chat-completions';
import type { ConnectionType, Model } from './types';

// Voyage AI documents no model list (docs research/embeddings-spike.md), so its embedding models are written here.
const embedding = (id: string): Model => ({ ...bareModel(id), input: ['text'], output: ['embedding'], contextLength: 32_000 });

export const voyage: ConnectionType = {
  id: 'voyage',
  label: 'Voyage AI',
  group: 'maker',
  description: '장기 기억 도구가 쓰는 임베딩 모델이에요.',
  keyPage: 'https://dashboard.voyageai.com/organization/api-keys',
  endpoint: { baseUrl: 'https://api.voyageai.com/v1', protocol: 'chat-completions' },
  detect: { key: /^pa-/, host: 'api.voyageai.com' },
  models: [embedding('voyage-4-lite'), embedding('voyage-4'), embedding('voyage-4-large')],
  embedPurpose: (as) => ({ input_type: as }),
};
