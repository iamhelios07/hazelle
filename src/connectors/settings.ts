import type { Model } from './types';

// A starred model's settings (design §4.4), in this app's own names. Each codec puts them into its wire
// format; a connection type adds only what its provider carries beyond its codec.
export const NUMBERS = ['maxOutput', 'temperature', 'topP', 'topK', 'frequencyPenalty', 'presencePenalty', 'repetitionPenalty', 'minP', 'seed'] as const;
export type NumberSetting = (typeof NUMBERS)[number];
export type Setting = NumberSetting | 'stop' | 'reasoning';

const WHOLE = new Set<NumberSetting>(['maxOutput', 'topK', 'seed']);

export type Reasoning =
  | { kind: 'off' }
  | { kind: 'level'; level: string }
  | { kind: 'budget'; tokens: number }
  | { kind: 'adaptive'; level: string | null };

// An absent field is unset: nothing is sent for it, and the provider's default applies (design §4.4).
// context is the prompt's own limit beside the catalog's context length; it is never sent.
export type ModelSettings = { [S in NumberSetting]?: number } & {
  context?: number;
  stop?: string[];
  reasoning?: Reasoning;
  systemAsUser?: true;
};

export type Bounds = { min: number | null; max: number | null };

// What a catalog says a model takes. settings lists the request settings it takes, so one left out is
// not taken; null means the catalog keeps no such list. reasoning is null when the catalog does not
// describe the model's reasoning controls, and each control is null where it is silent; budget holds
// the bounds the catalog names.
export type Takes = { settings: Setting[] | null; reasoning: ReasoningTakes | null };
export type ReasoningTakes = { off: boolean | null; levels: string[] | null; budget: Bounds | false | null; adaptive: boolean | null };

// What a wire format can put in a request, with the bounds it allows. No model on it takes a setting
// it cannot carry. always: the format sends that setting on every request.
export type Carries = {
  numbers: { [S in NumberSetting]?: Bounds & { always?: true } };
  reasoning: { off: boolean; levels: string[]; budget: Bounds | null; adaptive: boolean };
};

// null is unknown: the screen says so ("받는지 알 수 없어요") and still lets it be set and sent. Only a
// known false is refused before sending.
export type Accepts = boolean | null;
export type Rule = Bounds & { accepted: Accepts; whole: boolean };

export type SettingsSchema = {
  numbers: Record<NumberSetting, Rule>;
  stop: Accepts;
  reasoning: { off: Accepts; level: Accepts; levels: string[]; budget: Rule; adaptive: Accepts };
  prefill: Accepts;
};

export type Problem = { setting: Setting; problem: 'not-accepted' | 'out-of-range' };

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
  const listed = model.takes?.settings ?? null;
  const facts = model.takes?.reasoning ?? null;
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
    stop: takes('stop'),
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
  };
}

const within = (value: number, rule: Rule) =>
  (!rule.whole || Number.isSafeInteger(value)) && (rule.min === null || value >= rule.min) && (rule.max === null || value <= rule.max);

// What in a model's settings its schema refuses. context is left out: it is never sent.
export function problems(schema: SettingsSchema, settings: ModelSettings): Problem[] {
  const found: Problem[] = [];
  for (const name of NUMBERS) {
    const value = settings[name];
    if (value === undefined) continue;
    const rule = schema.numbers[name];
    if (rule.accepted === false) found.push({ setting: name, problem: 'not-accepted' });
    else if (!within(value, rule)) found.push({ setting: name, problem: 'out-of-range' });
  }
  if (settings.stop && schema.stop === false) found.push({ setting: 'stop', problem: 'not-accepted' });
  const reasoning = settings.reasoning && reasoningProblem(schema.reasoning, settings.reasoning);
  if (reasoning) found.push({ setting: 'reasoning', problem: reasoning });
  return found;
}

function reasoningProblem(rules: SettingsSchema['reasoning'], reasoning: Reasoning): Problem['problem'] | null {
  const level = (named: string) => (rules.levels.includes(named) ? null : 'out-of-range');
  switch (reasoning.kind) {
    case 'off':
      return rules.off === false ? 'not-accepted' : null;
    case 'level':
      return rules.level === false ? 'not-accepted' : level(reasoning.level);
    case 'budget':
      return rules.budget.accepted === false ? 'not-accepted' : within(reasoning.tokens, rules.budget) ? null : 'out-of-range';
    case 'adaptive':
      if (rules.adaptive === false || (reasoning.level !== null && rules.level === false)) return 'not-accepted';
      return reasoning.level === null ? null : level(reasoning.level);
  }
}
