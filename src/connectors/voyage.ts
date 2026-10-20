import { bareModel } from './chat-completions';
import { CONNECTOR_MODELS } from './models-dev';
import type { ConnectionType, Model } from './types';

// Voyage AI documents no model list (docs research/embeddings-spike.md), so its embedding models are written in
// CONNECTOR_MODELS.
const embedding = (id: string): Model => ({ ...bareModel(id), input: ['text'], output: ['embedding'], contextLength: 32_000 });

export const voyage: ConnectionType = {
  browser: {},
  id: 'voyage',
  label: 'Voyage AI',
  group: 'maker',
  description: '장기 기억과 플러그인이 쓰는 임베딩 모델이에요.',
  keyPage: 'https://dashboard.voyageai.com/organization/api-keys',
  endpoint: { baseUrl: 'https://api.voyageai.com/v1', protocol: 'chat-completions' },
  detect: { key: /^pa-/, host: 'api.voyageai.com' },
  models: CONNECTOR_MODELS.voyage.map(({ id }) => embedding(id)),
  embedPurpose: (as) => ({ input_type: as }),
};
