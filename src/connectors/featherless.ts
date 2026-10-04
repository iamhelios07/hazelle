import { bareModel } from './chat-completions';
import type { ConnectionType, Model } from './types';
import { count, flag, isRecord, modelEntries } from './values';

// Its public list holds every model on Featherless, text-to-speech and classifier models among them. features names
// only what a model has, so an absent flag stays unknown. context_length is the model's: the Basic and Premium plans
// stop at 32K.
export const featherless: ConnectionType = {
  id: 'featherless',
  label: 'Featherless',
  group: 'gateway',
  description: '공개 모델 수천 개를 월정액으로 불러요.',
  keyPage: 'https://featherless.ai/account/api-keys',
  endpoint: { baseUrl: 'https://api.featherless.ai/v1', protocol: 'chat-completions' },
  detect: { key: null, host: 'api.featherless.ai' },
  parseModels: (payload) =>
    modelEntries(payload)?.flatMap((raw): Model[] => {
      const features = isRecord(raw.features) ? raw.features : {};
      if (features.audio_output === true || features.classifier === true) return [];
      return [{
        ...bareModel(raw.id),
        input: features.image_input === true ? ['text', 'image'] : null,
        contextLength: count(raw.context_length),
        maxOutput: count(raw.max_completion_tokens),
        tools: flag(features.tool_use),
      }];
    }) ?? null,
};
