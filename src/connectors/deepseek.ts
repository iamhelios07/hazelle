import { bareModel } from './chat-completions';
import { effortLevels } from './settings';
import type { ConnectionType, Model } from './types';
import { count, isRecord, modalities, modelEntries, nameOf } from './values';

export const deepseek: ConnectionType = {
  id: 'deepseek',
  label: 'DeepSeek',
  group: 'maker',
  description: 'DeepSeek 모델을 만든 곳에 바로 연결해요.',
  keyPage: 'https://platform.deepseek.com/api_keys',
  endpoint: { baseUrl: 'https://api.deepseek.com', protocol: 'chat-completions' },
  detect: { key: null, host: 'api.deepseek.com' },

  // Its chat takes reasoning_effort none to turn thinking off, which supported_levels leaves out.
  parseModels: (payload) =>
    modelEntries(payload)?.map((raw): Model => {
      const effort = isRecord(raw.effort) ? raw.effort : null;
      return {
        ...bareModel(raw.id),
        name: nameOf(raw, 'name'),
        input: modalities(raw.input_modalities),
        output: modalities(raw.output_modalities),
        contextLength: count(raw.context_window),
        maxOutput: count(raw.max_output_tokens),
        reasoning: effort ? true : null,
        takes: { settings: null, reasoning: effort && { off: true, levels: effortLevels(effort.supported_levels)?.levels ?? null, budget: null, adaptive: null } },
      };
    }) ?? null,
};
