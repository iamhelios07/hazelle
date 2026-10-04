import { bareModel } from './chat-completions';
import { statedPrice } from './pricing';
import type { ConnectionType, Model } from './types';
import { amount, count, isRecord, list, modelEntries } from './values';

// Its list (GET /v1/openai/models, public) also holds image, audio and embedding models; only entries tagged `chat`
// are chat models. Tags are curated, so a missing `reasoning` tag means the model does not reason.
export const deepinfra: ConnectionType = {
  id: 'deepinfra',
  label: 'DeepInfra',
  group: 'gateway',
  description: '여러 회사의 공개 모델을 DeepInfra 서버에서 돌려요.',
  keyPage: 'https://deepinfra.com/dash/api_keys',
  endpoint: { baseUrl: 'https://api.deepinfra.com/v1/openai', protocol: 'chat-completions' },
  detect: { key: null, host: 'api.deepinfra.com' },
  parseModels: (payload) =>
    modelEntries(payload)?.flatMap((raw): Model[] => {
      const metadata = isRecord(raw.metadata) ? raw.metadata : {};
      const tags = list(metadata.tags);
      // Its pricing is already per million tokens.
      const pricing = isRecord(metadata.pricing) ? metadata.pricing : {};
      if (!tags.includes('chat')) return [];
      return [{
        ...bareModel(raw.id),
        input: tags.includes('vision') ? ['text', 'image'] : ['text'],
        output: ['text'],
        contextLength: count(metadata.context_length),
        maxOutput: count(metadata.max_tokens),
        reasoning: tags.includes('reasoning'),
        price: statedPrice(amount(pricing.input_tokens), amount(pricing.output_tokens), amount(pricing.cache_read_tokens), null),
      }];
    }) ?? null,
};
