import { describe, expect, it } from 'vitest';
import copilotModels from './fixtures/copilot-models.json';
import openRouterModels from './fixtures/openrouter-models.json';
import vercelModels from './fixtures/vercel-models.json';
import { chatRequest, modelSettings, parseCatalog, resolveConnection, resolveModel } from './registry';
import { fit, type ModelSettings } from './settings';
import type { Connection, Model } from './types';

const connection = (type: string, extra: Partial<Connection> = {}): Connection => ({ type, label: type, baseUrl: null, protocol: null, secret: 'key', starred: [], ...extra });
const generic = connection('generic', { baseUrl: 'https://api.example.com/v1', protocol: 'chat-completions' });
const bare: Model = { id: 'm', name: 'm', input: null, output: null, contextLength: null, maxOutput: null, reasoning: null, tools: null, protocol: null };

function listed(type: string, payload: unknown, id: string): Model {
  return parseCatalog(resolveConnection(connection(type))!, payload)!.find((model) => model.id === id)!;
}

function body(on: Connection, model: Model, settings: ModelSettings) {
  const route = resolveModel(resolveConnection(on)!, model);
  const messages = [
    { role: 'system' as const, content: '짧게 답해.' },
    { role: 'user' as const, content: '안녕' },
  ];
  return JSON.parse(chatRequest(route, { model, messages, settings }).body!) as Record<string, unknown>;
}

describe('what a model takes', () => {
  it('reads OpenRouter’s parameter list and reasoning controls', () => {
    const schema = modelSettings(connection('openrouter'), listed('openrouter', openRouterModels, 'anthropic/claude-opus-5.5'))!;
    expect(schema.numbers).toMatchObject({
      maxOutput: { accepted: true, min: 1, max: 128_000, whole: true },
      temperature: { accepted: true, min: 0, max: 2 },
      topP: { accepted: false },
      seed: { accepted: false },
    });
    expect(schema.stop).toBe(true);
    // Its catalog does not say whether a budget works; adaptive thinking has no field in this format.
    expect(schema.reasoning).toMatchObject({ off: false, level: true, levels: ['max', 'xhigh', 'high', 'medium', 'low'], budget: { accepted: null }, adaptive: false });
  });

  it('reads Vercel’s, where a model without reasoning takes none of its controls', () => {
    const fable = modelSettings(connection('vercel'), listed('vercel', vercelModels, 'anthropic/claude-fable-5'))!;
    expect(fable.numbers.temperature.accepted).toBe(false);
    expect(fable.reasoning).toMatchObject({ off: true, level: true, budget: { accepted: true, min: 1, max: null }, adaptive: false });
    const qwen = modelSettings(connection('vercel'), listed('vercel', vercelModels, 'alibaba/qwen3-coder'))!;
    expect(qwen.numbers.temperature.accepted).toBe(true);
    expect(qwen.reasoning).toMatchObject({ off: false, level: false, budget: { accepted: false }, adaptive: false });
  });

  it('leaves sampling unknown where the catalog does not list it, and false where the protocol cannot carry it', () => {
    const claude = modelSettings(connection('copilot'), listed('copilot', copilotModels, 'claude-opus-4.6'))!;
    expect(claude.numbers).toMatchObject({
      maxOutput: { accepted: true, max: 64000 },
      temperature: { accepted: null, min: 0, max: 1 },
      frequencyPenalty: { accepted: false },
    });
    expect(claude.reasoning).toMatchObject({ level: null, levels: ['low', 'medium', 'high', 'xhigh', 'max'], budget: { accepted: true, min: 1024, max: 32000 }, adaptive: true });
    const mini = modelSettings(connection('copilot'), listed('copilot', copilotModels, 'gpt-5-mini'))!;
    expect(mini.reasoning).toMatchObject({ level: true, levels: ['low', 'medium', 'high'], budget: { accepted: false }, adaptive: false });
    expect(modelSettings(connection('copilot'), listed('copilot', copilotModels, 'gpt-5.1-codex'))).toBeNull();
  });

  it('knows nothing of a model on a connection the user described, beyond what its protocol cannot carry', () => {
    const schema = modelSettings(generic, bare)!;
    expect(Object.values(schema.numbers).map((rule) => rule.accepted)).toEqual(Array(9).fill(null));
    expect(schema).toMatchObject({ stop: null, reasoning: { off: null, level: null, budget: { accepted: false }, adaptive: false }, prefill: null });
    const anthropic = modelSettings(connection('generic', { baseUrl: 'https://api.example.com/v1', protocol: 'anthropic-messages' }), bare)!;
    expect(anthropic.numbers).toMatchObject({ maxOutput: { accepted: true }, temperature: { accepted: null }, seed: { accepted: false } });
  });
});

describe('what a request carries', () => {
  it('sends set values in the chat format’s own fields, and nothing for what is unset', () => {
    const settings: ModelSettings = { temperature: 0.8, topK: 40, seed: 7, stop: ['\n\n'], reasoning: { kind: 'level', level: 'high' }, systemAsUser: true, context: 100_000 };
    expect(body(generic, bare, settings)).toEqual({
      model: 'm',
      messages: [
        { role: 'user', content: '짧게 답해.' },
        { role: 'user', content: '안녕' },
      ],
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.8,
      top_k: 40,
      seed: 7,
      stop: ['\n\n'],
      reasoning_effort: 'high',
    });
    expect(body(generic, bare, { reasoning: { kind: 'off' } })).toMatchObject({ reasoning_effort: 'none' });
  });

  it('asks a gateway for a reasoning budget in its own field', () => {
    expect(body(connection('openrouter'), bare, { reasoning: { kind: 'budget', tokens: 2000 } })).toMatchObject({ reasoning: { max_tokens: 2000 } });
  });

  it('carries the user’s Risu preset to a Claude model on Copilot as the Messages format asks', () => {
    const claude = listed('copilot', copilotModels, 'claude-opus-4.6');
    const preset: ModelSettings = { maxOutput: 6000, temperature: 1, context: 200_000, reasoning: { kind: 'adaptive', level: 'high' }, systemAsUser: true };
    expect(body(connection('copilot'), claude, preset)).toEqual({
      model: 'claude-opus-4.6',
      max_tokens: 6000,
      messages: [
        { role: 'user', content: '짧게 답해.' },
        { role: 'user', content: '안녕' },
      ],
      temperature: 1,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      stream: true,
    });
    expect(body(connection('copilot'), claude, { reasoning: { kind: 'budget', tokens: 4096 } })).toMatchObject({ max_tokens: 64000, thinking: { type: 'enabled', budget_tokens: 4096 } });
  });

  it('leaves out what the model does not take and brings a value past its bounds within them, and names each', () => {
    const claude = listed('copilot', copilotModels, 'claude-opus-4.6');
    const fitted: ModelSettings = { frequencyPenalty: 0.5, temperature: 1.5, context: 10_000_000, reasoning: { kind: 'budget', tokens: 50_000 } };
    expect(fit(modelSettings(connection('copilot'), claude)!, fitted).changes).toEqual([
      { setting: 'temperature', change: 'capped', to: 1 },
      { setting: 'frequencyPenalty', change: 'left-out' },
      { setting: 'context', change: 'capped', to: claude.contextLength },
      { setting: 'reasoning', change: 'capped', to: 32_000 },
    ]);
    const sent = body(connection('copilot'), claude, fitted);
    expect(sent).toMatchObject({ temperature: 1, thinking: { type: 'enabled', budget_tokens: 32_000 } });
    expect(sent).not.toHaveProperty('frequency_penalty');
  });
});
