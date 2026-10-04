import { bareModel } from './chat-completions';
import type { ConnectionType, Modality, Model } from './types';
import { count, flag, modelEntries } from './values';

export const moonshot: ConnectionType = {
  id: 'moonshot',
  label: 'Moonshot AI',
  group: 'maker',
  description: 'Kimi를 만든 곳에 바로 연결해요.',
  keyPage: 'https://platform.kimi.ai/console/api-keys',
  // The international host; api.moonshot.cn is the mainland one.
  endpoint: { baseUrl: 'https://api.moonshot.ai/v1', protocol: 'chat-completions' },
  detect: { key: null, host: 'api.moonshot.ai' },

  parseModels: (payload) =>
    modelEntries(payload)?.map((raw): Model => {
      const image = flag(raw.supports_image_in);
      const video = flag(raw.supports_video_in);
      const input: Modality[] | null = image === null || video === null ? null : ['text', ...(image ? ['image' as const] : []), ...(video ? ['video' as const] : [])];
      return { ...bareModel(raw.id), input, contextLength: count(raw.context_length), reasoning: flag(raw.supports_reasoning) };
    }) ?? null,
};
