import { bareModel } from './chat-completions';
import { effortLevels, type ReasoningTakes } from './settings';
import type { ConnectionType, Model } from './types';
import { count, flag, isRecord, modalities, modelEntries } from './values';

// Friendli turns reasoning off with chat_template_kwargs.enable_thinking, not the reasoning_effort "none" this format
// sends, so no model here offers off.
function reasoningTakes(options: unknown): ReasoningTakes | null {
  if (!Array.isArray(options)) return null;
  const option = (type: string) => options.find((raw): raw is Record<string, unknown> => isRecord(raw) && raw.type === type);
  const budget = option('budget_tokens');
  return {
    off: false,
    levels: effortLevels(option('effort')?.values)?.levels ?? [],
    // Its min is -1, meaning no limit, which is no lower bound.
    budget: budget ? { min: null, max: count(budget.max) } : false,
    adaptive: null,
  };
}

export const friendli: ConnectionType = {
  id: 'friendli',
  label: 'Friendli',
  group: 'gateway',
  description: '여러 회사의 공개 모델을 Friendli 서버에서 돌려요.',
  keyPage: 'https://friendli.ai/suite/~/setting/keys',
  endpoint: { baseUrl: 'https://api.friendli.ai/serverless/v1', protocol: 'chat-completions' },
  detect: { key: /^flp_/, host: 'api.friendli.ai' },
  parseModels: (payload) =>
    modelEntries(payload)?.map((raw): Model => ({
      ...bareModel(raw.id),
      input: modalities(raw.input_modalities),
      output: modalities(raw.output_modalities),
      contextLength: count(raw.context_length),
      maxOutput: count(raw.max_completion_tokens),
      reasoning: flag(raw.reasoning),
      tools: isRecord(raw.functionality) ? flag(raw.functionality.tool_call) : null,
      takes: { settings: null, reasoning: reasoningTakes(raw.reasoning_options) },
    })) ?? null,
  reasoningBudget: (tokens) => ({ reasoning_budget: tokens }),
};
