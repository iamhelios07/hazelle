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
  description: '공개 모델 수천 개를 월정액으로 사용해요.',
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

  // The plan's only allowance: concurrent units held by requests in flight, 1 to 4 per request by model size, not
  // requests. A null limit is an unlimited plan. Its model list is public, so this call is what checks a pasted key.
  meters: [{
    request: (secret) => ({ url: 'https://api.featherless.ai/account/concurrency', method: 'GET', headers: { authorization: `Bearer ${secret}` }, body: null }),
    parse(payload) {
      if (!isRecord(payload)) return null;
      const limit = count(payload.limit);
      const used = count(payload.used_cost);
      return limit === null || used === null ? [] : [{ kind: 'left', label: '동시 실행 단위', unit: 'concurrency', amount: Math.max(limit - used, 0), limit, resets: null }];
    },
  }],
};
