import { listedSettings } from './chat-completions';
import { effortLevels, type ReasoningTakes } from './settings';
import type { ConnectionType, Meter, MeterReset, Modality } from './types';
import { amount, count, isRecord, modelEntries } from './values';

const MODALITIES = new Set<Modality>(['text', 'image', 'audio', 'video', 'file']);

function modalities(value: unknown): Modality[] | null {
  return Array.isArray(value) ? value.filter((item): item is Modality => MODALITIES.has(item as Modality)) : null;
}

// mandatory: reasoning cannot be turned off. supports_max_tokens: a token budget can be asked for.
function reasoningTakes(raw: Record<string, unknown>): ReasoningTakes {
  const efforts = effortLevels(raw.supported_efforts);
  return {
    off: raw.mandatory === true ? false : raw.mandatory === false || efforts?.none ? true : null,
    levels: efforts?.levels ?? null,
    budget: typeof raw.supports_max_tokens === 'boolean' ? raw.supports_max_tokens && { min: null, max: null } : null,
    adaptive: null,
  };
}

const RESETS: Partial<Record<string, MeterReset>> = { daily: 'daily', weekly: 'weekly', monthly: 'monthly' };

// GET /key describes the key, not the account: the account's credits need a management key, which
// cannot call models, so they are not read. Days and months are UTC ones.
function meters(payload: unknown): Meter[] | null {
  if (!isRecord(payload) || !isRecord(payload.data)) return null;
  const { data } = payload;
  const found: Meter[] = [];
  const limit = amount(data.limit);
  const remaining = amount(data.limit_remaining);
  if (limit !== null && remaining !== null) {
    const resets = typeof data.limit_reset === 'string' ? (RESETS[data.limit_reset] ?? null) : null;
    found.push({ kind: 'left', label: '이 키 한도', unit: 'usd', amount: remaining, limit, resets });
  }
  for (const [field, label] of [['usage_monthly', '이번 달 쓴 돈'], ['usage', '지금까지 쓴 돈']] as const) {
    const spent = amount(data[field]);
    if (spent !== null) found.push({ kind: 'spent', label, unit: 'usd', amount: spent });
  }
  const free = isRecord(data.free_model_daily_requests) ? data.free_model_daily_requests : {};
  const freeLeft = count(free.remaining);
  const freeLimit = count(free.limit);
  if (freeLeft !== null && freeLimit !== null) found.push({ kind: 'left', label: '무료 모델 요청', unit: 'requests', amount: freeLeft, limit: freeLimit, resets: 'daily' });
  return found;
}

export const openRouter: ConnectionType = {
  id: 'openrouter',
  label: 'OpenRouter',
  group: 'gateway',
  major: true,
  description: '여러 회사의 모델을 키 하나로 써요.',
  keyPage: 'https://openrouter.ai/settings/keys',
  endpoint: { baseUrl: 'https://openrouter.ai/api/v1', protocol: 'chat-completions' },
  detect: { key: /^sk-or-/, host: 'openrouter.ai' },

  // Names read "Anthropic: Claude Opus 5.5"; the id already carries the maker, so the prefix is dropped.
  parseModels(payload) {
    return (
      modelEntries(payload)?.map((raw) => {
        const architecture = isRecord(raw.architecture) ? raw.architecture : {};
        const topProvider = isRecord(raw.top_provider) ? raw.top_provider : {};
        const parameters = Array.isArray(raw.supported_parameters) ? raw.supported_parameters : null;
        const name = typeof raw.name === 'string' && raw.name ? raw.name.replace(/^[^:]+:\s+(?=\S)/, '') : raw.id;
        return {
          id: raw.id,
          name,
          input: modalities(architecture.input_modalities),
          output: modalities(architecture.output_modalities),
          contextLength: count(raw.context_length),
          maxOutput: count(topProvider.max_completion_tokens),
          reasoning: parameters ? parameters.includes('reasoning') : null,
          tools: parameters ? parameters.includes('tools') : null,
          protocol: null,
          takes: { settings: parameters && listedSettings(parameters), reasoning: isRecord(raw.reasoning) ? reasoningTakes(raw.reasoning) : null },
        };
      }) ?? null
    );
  },

  reasoningBudget: (tokens) => ({ reasoning: { max_tokens: tokens } }),

  cacheControl: true,

  // OpenRouter reports what the call cost, in US dollars, with the final usage.
  cost: ({ facts }) => (typeof facts.rawUsage.cost === 'number' && Number.isFinite(facts.rawUsage.cost) ? { unit: 'usd', amount: facts.rawUsage.cost, source: 'reported' } : null),

  meters: {
    request: (secret) => ({ url: 'https://openrouter.ai/api/v1/key', method: 'GET', headers: { authorization: `Bearer ${secret}` }, body: null }),
    parse: meters,
  },
};
