import { bareModel } from './chat-completions';
import type { ConnectionType, Model } from './types';
import { count, modalities, modelEntries } from './values';

export const chutes: ConnectionType = {
  id: 'chutes',
  label: 'Chutes',
  group: 'gateway',
  description: '여러 회사의 공개 모델을 Chutes 분산 서버에서 실행해요.',
  keyPage: 'https://chutes.ai/app',
  endpoint: { baseUrl: 'https://llm.chutes.ai/v1', protocol: 'chat-completions' },
  embeds: null,
  detect: { key: /^cpk_/, host: 'llm.chutes.ai' },
  // context_length is what Chutes serves; max_model_len is the model's own and can be larger.
  parseModels: (payload) =>
    modelEntries(payload)?.map((raw): Model => {
      const features = Array.isArray(raw.supported_features) ? raw.supported_features : null;
      return {
        ...bareModel(raw.id),
        input: modalities(raw.input_modalities),
        output: modalities(raw.output_modalities),
        contextLength: count(raw.context_length),
        maxOutput: count(raw.max_output_length),
        reasoning: features && features.includes('reasoning'),
        tools: features && features.includes('tools'),
      };
    }) ?? null,
};
