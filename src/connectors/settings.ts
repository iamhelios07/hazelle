import type { Model } from './types';

export const NUMBERS = ['maxOutput', 'temperature', 'topP', 'topK', 'frequencyPenalty', 'presencePenalty', 'repetitionPenalty', 'minP', 'seed'] as const;
export type NumberSetting = (typeof NUMBERS)[number];
export type Setting = NumberSetting | 'stop' | 'reasoning' | 'verbosity' | 'serviceTier';

export const WHOLE = new Set<NumberSetting>(['maxOutput', 'topK', 'seed']);

export type Reasoning =
  | { kind: 'off' }
  | { kind: 'level'; level: string }
  | { kind: 'budget'; tokens: number }
  | { kind: 'adaptive'; level: string | null };

// An absent field is unset: nothing is sent for it, and the provider's default applies.
// context is the prompt's own limit beside the catalog's context length; it is never sent.
export type ModelSettings = { [S in NumberSetting]?: number } & {
  context?: number;
  stop?: string[];
  reasoning?: Reasoning;
  systemAsUser?: true;
  // Every model takes it, so fit() never leaves it out.
  streaming?: false;
  cache?: Cache;
  verbosity?: Verbosity;
  serviceTier?: ServiceTier;
};
export type Cache = '5m' | '1h';
export const VERBOSITY = ['low', 'medium', 'high'] as const;
export type Verbosity = (typeof VERBOSITY)[number];
// Anthropic's service_tier: auto may use the account's Priority Tier capacity; standard_only never does.
export const SERVICE_TIERS = ['auto', 'standard_only'] as const;
export type ServiceTier = (typeof SERVICE_TIERS)[number];

export type Bounds = { min: number | null; max: number | null };

// settings lists the request settings it takes, so one left out is not taken; null means the catalog keeps no such
// list. reasoning is null when the catalog does not describe the model's reasoning controls, and each control is null
// where it is silent; budget holds the bounds the catalog names.
export type Takes = { settings: Setting[] | null; reasoning: ReasoningTakes | null };
export type ReasoningTakes = { off: boolean | null; levels: string[] | null; budget: Bounds | false | null; adaptive: boolean | null };

// No model on it takes a setting it cannot carry. always: the format sends that setting on every request.
export type Carries = {
  numbers: { [S in NumberSetting]?: Bounds & { always?: true } };
  reasoning: { off: boolean; levels: string[]; budget: Bounds | null; adaptive: boolean };
  stop: boolean;
  verbosity: boolean;
  serviceTier: boolean;
  // Whether the route can mark cache points: true where every model on it takes them, null where some may not.
  cache: Accepts;
};

// null is unknown: the screen says so ("받는지 알 수 없어요") and still lets it be set and sent. Only a
// known false is refused before sending.
export type Accepts = boolean | null;
export type Rule = Bounds & { accepted: Accepts; whole: boolean };

// context is the catalog's context length, which the prompt's own limit never goes past.
export type SettingsSchema = {
  numbers: Record<NumberSetting, Rule>;
  context: Rule;
  stop: Accepts;
  reasoning: { off: Accepts; level: Accepts; levels: string[]; budget: Rule; adaptive: Accepts };
  prefill: Accepts;
  cache: Accepts;
  verbosity: Accepts;
  serviceTier: Accepts;
};

// left-out: the model does not take it, or not the level named. capped: brought within the model's bounds, to that value.
export type Change = { setting: Setting | 'context' | 'cache'; change: 'left-out' } | { setting: NumberSetting | 'context' | 'reasoning'; change: 'capped'; to: number };
export type Fitted = { settings: ModelSettings; changes: Change[] };

// Catalogs list 'none' among the effort levels of a model whose reasoning can be turned off; here that
// is the off control, not a level.
export function effortLevels(values: unknown): { levels: string[]; none: boolean } | null {
  if (!Array.isArray(values)) return null;
  const named = values.filter((value): value is string => typeof value === 'string' && value !== '');
  return { levels: named.filter((level) => level !== 'none'), none: named.includes('none') };
}

// The protocol decides what can be carried at all; the catalog decides what this model takes. Carried
// but not described stays unknown: a protocol field is no promise that a model takes it (Anthropic's
// models from 4.7 on refuse temperature, which the Messages format carries).
export function settingsSchema(carries: Carries, model: Model): SettingsSchema {
  const listed = model.takes.settings;
  const facts = model.takes.reasoning;
  const takes = (setting: Setting): Accepts => (listed === null ? null : listed.includes(setting));
  const numbers = Object.fromEntries(
    NUMBERS.map((name): [NumberSetting, Rule] => {
      const bounds = carries.numbers[name];
      const accepted = !bounds ? false : bounds.always ? true : takes(name);
      const max = name === 'maxOutput' ? model.maxOutput : (bounds?.max ?? null);
      return [name, { accepted, min: bounds?.min ?? null, max, whole: WHOLE.has(name) }];
    }),
  ) as Record<NumberSetting, Rule>;

  const reasoning = takes('reasoning');
  const control = (carried: boolean, fact: boolean | null | undefined): Accepts => (!carried || reasoning === false ? false : (fact ?? null));
  const levels = facts?.levels ?? null;
  const budget = facts?.budget ?? null;
  const stated = budget || null;
  const carriedBudget = carries.reasoning.budget;
  return {
    numbers,
    context: { accepted: true, min: 1, max: model.contextLength, whole: true },
    stop: carries.stop ? takes('stop') : false,
    reasoning: {
      off: control(carries.reasoning.off, facts?.off),
      level: control(true, levels && levels.length > 0),
      levels: levels ?? carries.reasoning.levels,
      budget: {
        accepted: control(carriedBudget !== null, budget === null ? null : budget !== false),
        // A budget counts tokens, so none is below one where neither the protocol nor the catalog says.
        min: stated?.min ?? carriedBudget?.min ?? 1,
        max: stated?.max ?? carriedBudget?.max ?? null,
        whole: true,
      },
      adaptive: control(carries.reasoning.adaptive, facts?.adaptive),
    },
    // No catalog read here states it (Anthropic's capabilities, Copilot's supports, OpenRouter's and
    // Vercel's lists, checked 2026-09-28), and the Messages format cannot vouch for it: Anthropic's own
    // models from 4.6 on refuse a prefill. A connection type that learns it per model fills it here.
    prefill: null,
    // No catalog lists it, so it is the format's word, or the connection type's.
    cache: carries.cache,
    verbosity: carries.verbosity ? takes('verbosity') : false,
    serviceTier: carries.serviceTier ? takes('serviceTier') : false,
  };
}

const within = (value: number, rule: Bounds) => Math.min(Math.max(value, rule.min ?? value), rule.max ?? value);

// Unknown is sent as it is.
export function fit(schema: SettingsSchema, settings: ModelSettings): Fitted {
  const sent: ModelSettings = { ...settings };
  const changes: Change[] = [];
  const leave = (setting: Setting | 'context' | 'cache') => {
    delete sent[setting];
    changes.push({ setting, change: 'left-out' });
  };
  const cap = (setting: NumberSetting | 'context', value: number, rule: Bounds) => {
    const to = within(value, rule);
    if (to === value) return;
    sent[setting] = to;
    changes.push({ setting, change: 'capped', to });
  };
  for (const name of NUMBERS) {
    const value = settings[name];
    if (value === undefined) continue;
    if (schema.numbers[name].accepted === false) leave(name);
    else cap(name, value, schema.numbers[name]);
  }
  if (settings.context !== undefined) cap('context', settings.context, schema.context);
  if (settings.stop && schema.stop === false) leave('stop');
  if (settings.cache && schema.cache === false) leave('cache');
  if (settings.verbosity && schema.verbosity === false) leave('verbosity');
  if (settings.serviceTier && schema.serviceTier === false) leave('serviceTier');
  const { reasoning } = settings;
  if (reasoning?.kind === 'budget' && schema.reasoning.budget.accepted !== false) {
    const tokens = within(reasoning.tokens, schema.reasoning.budget);
    if (tokens !== reasoning.tokens) {
      sent.reasoning = { kind: 'budget', tokens };
      changes.push({ setting: 'reasoning', change: 'capped', to: tokens });
    }
  } else if (reasoning && refused(schema.reasoning, reasoning)) {
    leave('reasoning');
  }
  return { settings: sent, changes };
}

function refused(rules: SettingsSchema['reasoning'], reasoning: Reasoning): boolean {
  const unnamed = (level: string | null) => level !== null && (rules.level === false || !rules.levels.includes(level));
  switch (reasoning.kind) {
    case 'off':
      return rules.off === false;
    case 'level':
      return unnamed(reasoning.level);
    case 'budget':
      return rules.budget.accepted === false;
    case 'adaptive':
      return rules.adaptive === false || unnamed(reasoning.level);
  }
}
