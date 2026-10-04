import { bareModel } from './chat-completions';
import type { ConnectionType, Model } from './types';
import { count, flag, isRecord, modelEntries } from './values';

export const mistral: ConnectionType = {
  id: 'mistral',
  label: 'Mistral AI',
  group: 'maker',
  description: 'Mistral 모델을 만든 곳에 바로 연결해요.',
  keyPage: 'https://console.mistral.ai',
  endpoint: { baseUrl: 'https://api.mistral.ai/v1', protocol: 'chat-completions' },
  detect: { key: null, host: 'api.mistral.ai' },

  // The list also holds embedding, OCR and moderation models, which say completion_chat: false.
  parseModels: (payload) =>
    modelEntries(payload)?.flatMap((raw): Model[] => {
      const can = isRecord(raw.capabilities) ? raw.capabilities : {};
      if (can.completion_chat === false) return [];
      const vision = flag(can.vision);
      return [{ ...bareModel(raw.id), input: vision === null ? null : vision ? ['text', 'image'] : ['text'], contextLength: count(raw.max_context_length), tools: flag(can.function_calling) }];
    }) ?? null,
};
