import { describe, expect, it } from 'vitest';
import { anthropicMessages } from './anthropic-messages';
import { copilot } from './copilot';
import copilotModels from './fixtures/copilot-models.json';
import openRouterKey from './fixtures/openrouter-key.json';
import openRouterModels from './fixtures/openrouter-models.json';
import vercelModels from './fixtures/vercel-models.json';
import { nanogpt } from './nanogpt';
import { openRouter } from './openrouter';
import { vercel } from './vercel';
import {
  cacheView,
  chatRequest,
  CONNECTION_TYPES,
  detect,
  normalizeBaseUrl,
  parseCatalog,
  resolveConnection,
  resolveModel,
  searchTypes,
  withCredential,
} from './registry';
import { ConnectorError, type Connection, type Model } from './types';

const connection = (type: string, extra: Partial<Connection> = {}) =>
  resolveConnection({ type, label: type, baseUrl: null, protocol: null, secret: 'key', starred: [], ...extra })!;

const model = (extra: Partial<Model> = {}): Model => ({
  id: 'm',
  name: 'm',
  input: null,
  output: null,
  contextLength: null,
  maxOutput: null,
  reasoning: null,
  tools: null,
  protocol: null,
  takes: { settings: null, reasoning: null },
  ...extra,
});

describe('detection', () => {
  it('recognizes built-in keys and hosts', () => {
    expect(detect('  sk-or-v1-abc  ')).toMatchObject({ kind: 'key', type: { id: 'openrouter' }, secret: 'sk-or-v1-abc' });
    expect(detect('sk-ant-api03-xyz')).toMatchObject({ kind: 'key', type: { id: 'anthropic' } });
    expect(detect('https://openrouter.ai/api/v1/chat/completions')).toMatchObject({ kind: 'url', type: { id: 'openrouter' } });
    expect(detect('https://ollama.com/v1/chat/completions')).toMatchObject({ kind: 'url', type: { id: 'ollama' } });
  });

  it.each([
    ['sk-proj-abc', 'https://api.openai.com/v1', 'openai'],
    ['xai-abc', 'https://api.x.ai/v1', 'xai'],
    ['pplx-abc', 'https://api.perplexity.ai/router/v1', 'perplexity'],
    ['gsk_abc', 'https://api.groq.com/openai/v1', 'groq'],
    ['csk-abc', 'https://api.cerebras.ai/v1', 'cerebras'],
    ['inf_abc', 'https://api.surplusintelligence.ai/v1', 'surplus'],
    ['cpk_abc', 'https://llm.chutes.ai/v1', 'chutes'],
    ['up_abc', 'https://api.upstage.ai/v1', 'upstage'],
    ['flp_abc', 'https://api.friendli.ai/serverless/v1', 'friendli'],
    [null, 'https://api.featherless.ai/v1', 'featherless'],
    [null, 'https://api.nano-gpt.com/api/v1', 'nanogpt'],
    [null, 'https://api.deepinfra.com/v1/openai', 'deepinfra'],
    [null, 'https://api.deepseek.com', 'deepseek'],
    [null, 'https://api.mistral.ai/v1', 'mistral'],
    [null, 'https://api.moonshot.ai/v1', 'moonshot'],
    [null, 'https://api.together.ai/v1', 'together'],
  ])('recognizes %s and %s as %s', (key, address, id) => {
    if (key) expect(detect(key)).toMatchObject({ kind: 'key', type: { id } });
    expect(detect(address)).toMatchObject({ kind: 'url', type: { id } });
  });

  it('takes any other address as a generic connection and flags ones the relay cannot reach', () => {
    expect(detect('https://llm.example.com/v1/')).toEqual({ kind: 'generic-url', baseUrl: 'https://llm.example.com/v1', problem: null });
    expect(detect('http://example.com/v1')).toMatchObject({ problem: 'not-https' });
    expect(detect('https://localhost:11434/v1')).toMatchObject({ problem: 'local' });
    expect(detect('https://192.168.0.10/v1')).toMatchObject({ problem: 'local' });
    expect(detect('https://my-nas.local/v1')).toMatchObject({ problem: 'local' });
  });

  it('reads a private address only from an address, never from a name that starts like one', () => {
    expect(detect('https://[fd00::1]/v1')).toMatchObject({ problem: 'local' });
    expect(detect('https://[::1]:8080/v1')).toMatchObject({ problem: 'local' });
    expect(detect('https://fd-gateway.example.com/v1')).toMatchObject({ problem: null });
    expect(detect('https://10.example.com/v1')).toMatchObject({ problem: null });
  });

  it('keeps an unrecognized key to ask for its address, and ignores prose', () => {
    expect(detect('sk-1234')).toEqual({ kind: 'unknown-key', secret: 'sk-1234' });
    expect(detect('이건 키가 아니에요')).toBeNull();
    expect(detect('   ')).toBeNull();
  });

  it('strips endpoint paths from an address', () => {
    expect(normalizeBaseUrl('https://api.anthropic.com/v1/messages')).toBe('https://api.anthropic.com/v1');
    expect(normalizeBaseUrl('https://example.com/openai/v1/models?x=1')).toBe('https://example.com/openai/v1');
    expect(normalizeBaseUrl('example.com')).toBeNull();
  });
});

describe('the 연결 추가 list', () => {
  const ids = (input: string) => {
    const search = searchTypes(input);
    return search.kind === 'types' ? search.types.map((type) => type.id) : search.kind;
  };

  it('reads a pasted key or address before taking the text as a name', () => {
    expect(ids('')).toEqual(CONNECTION_TYPES.map((type) => type.id));
    expect(searchTypes(' sk-or-v1-abc ')).toMatchObject({ kind: 'key', type: { id: 'openrouter' }, secret: 'sk-or-v1-abc' });
    expect(ids('https://openrouter.ai/api/v1/chat/completions')).toEqual(['openrouter']);
    expect(searchTypes('https://llm.example.com/v1/')).toEqual({ kind: 'address', baseUrl: 'https://llm.example.com/v1' });
  });

  it('finds a name in labels and descriptions, and says when nothing matches without guessing at keys', () => {
    expect(ids('open')).toEqual(['openrouter', 'openai']);
    expect(ids('ollama')).toEqual(['ollama']);
    expect(ids('Claude')).toEqual(['anthropic', 'copilot']);
    expect(ids('sk-1234')).toBe('none');
  });

  it('keeps a generic connection’s explicit endpoint and protocol even on a known host', () => {
    const saved: Connection = { type: 'generic', label: 'openrouter.ai', baseUrl: 'https://openrouter.ai/api/v1', protocol: 'anthropic-messages', secret: 'k', starred: [] };
    expect(resolveConnection(saved)).toMatchObject({ type: null, endpoint: { baseUrl: saved.baseUrl, protocol: 'anthropic-messages' }, codec: anthropicMessages });
  });
});

describe('catalogs', () => {
  it('reads OpenRouter capabilities and drops the maker prefix from names', () => {
    expect(parseCatalog(connection('openrouter'), openRouterModels)).toEqual([
      {
        id: 'anthropic/claude-opus-5.5',
        name: 'Claude Opus 5.5',
        input: ['text', 'image', 'file'],
        output: ['text'],
        contextLength: 1_000_000,
        maxOutput: 128_000,
        reasoning: true,
        tools: true,
        protocol: null,
        takes: {
          settings: ['maxOutput', 'temperature', 'stop', 'reasoning'],
          reasoning: { off: false, levels: ['max', 'xhigh', 'high', 'medium', 'low'], budget: null, adaptive: null },
        },
      },
      expect.objectContaining({ id: 'openrouter/auto-beta', name: 'Auto Router (Beta)', output: ['text', 'image'] }),
    ]);
  });

  it('reads Vercel language models only, with PDF input as a file and capabilities from tags', () => {
    expect(parseCatalog(connection('vercel'), vercelModels)).toEqual([
      {
        id: 'anthropic/claude-fable-5',
        name: 'Claude Fable 5',
        input: ['text', 'image', 'file'],
        output: ['text'],
        contextLength: 1_000_000,
        maxOutput: 128_000,
        reasoning: true,
        tools: true,
        protocol: null,
        takes: {
          settings: ['maxOutput', 'stop', 'reasoning'],
          reasoning: { off: true, levels: ['low', 'medium', 'high', 'xhigh', 'max'], budget: { min: null, max: null }, adaptive: null },
        },
      },
      expect.objectContaining({ id: 'alibaba/qwen3-coder', input: ['text'], reasoning: false, tools: true }),
    ]);
    const [, bare] = vercelModels.data;
    expect(parseCatalog(connection('vercel'), { data: [{ ...bare, tags: undefined, modalities: undefined }] })).toEqual([
      expect.objectContaining({ input: null, output: null, reasoning: null, tools: null }),
    ]);
  });

  it('reads Anthropic capabilities, with a zero limit as unknown', () => {
    const payload = {
      data: [
        {
          id: 'claude-opus-5',
          display_name: 'Claude Opus 5',
          capabilities: { image_input: { supported: true }, pdf_input: { supported: false }, thinking: { supported: true, types: {} } },
          max_input_tokens: 0,
          max_tokens: 128000,
          type: 'model',
        },
      ],
      has_more: false,
    };
    expect(parseCatalog(connection('anthropic'), payload)).toEqual([
      {
        id: 'claude-opus-5',
        name: 'Claude Opus 5',
        input: ['text', 'image'],
        output: ['text'],
        contextLength: null,
        maxOutput: 128000,
        reasoning: true,
        tools: null,
        protocol: null,
        takes: { settings: null, reasoning: { off: null, levels: null, budget: null, adaptive: null } },
      },
    ]);
  });

  it('reads a generic list as ids with every capability unknown', () => {
    const generic = connection('generic', { baseUrl: 'https://api.example.com/v1', protocol: 'chat-completions' });
    expect(withCredential(generic, generic.codec.listModels(generic.endpoint), 'k')).toEqual({ url: 'https://api.example.com/v1/models', method: 'GET', headers: { authorization: 'Bearer k' }, body: null });
    expect(parseCatalog(generic, { data: [{ id: 'deepseek-chat' }, { id: '' }, 'junk'] })).toEqual([model({ id: 'deepseek-chat', name: 'deepseek-chat' })]);
    expect(parseCatalog(generic, { models: [] })).toBeNull();
  });

  it('reads Together’s bare array and keeps only the chat models of Together and Mistral', () => {
    const together = [{ id: 'meta/llama', type: 'chat', display_name: 'Llama', context_length: 8192 }, { id: 'bge', type: 'embedding' }];
    expect(parseCatalog(connection('together'), together)).toEqual([model({ id: 'meta/llama', name: 'Llama', contextLength: 8192 })]);
    expect(parseCatalog(connection('together'), { data: together })).toBeNull();
    const mistral = { object: 'list', data: [{ id: 'mistral-large', capabilities: { completion_chat: true, vision: true, function_calling: true }, max_context_length: 131072 }, { id: 'mistral-embed', capabilities: { completion_chat: false } }] };
    expect(parseCatalog(connection('mistral'), mistral)).toEqual([model({ id: 'mistral-large', name: 'mistral-large', input: ['text', 'image'], contextLength: 131072, tools: true })]);
  });

  it('reads Chutes features, and leaves a model without them unknown', () => {
    const payload = { data: [
      { id: 'gemma', context_length: 131072, max_model_len: 262144, max_output_length: 65536, input_modalities: ['text', 'image'], output_modalities: ['text'], supported_features: ['json_mode', 'tools', 'reasoning'] },
      { id: 'nemo' },
    ] };
    expect(parseCatalog(connection('chutes'), payload)).toEqual([
      model({ id: 'gemma', name: 'gemma', input: ['text', 'image'], output: ['text'], contextLength: 131072, maxOutput: 65536, reasoning: true, tools: true }),
      model({ id: 'nemo', name: 'nemo' }),
    ]);
  });

  it('drops Featherless speech and classifier models and keeps an unnamed feature unknown', () => {
    const payload = { data: [
      { id: 'llama', context_length: 32768, max_completion_tokens: 4096, features: { tool_use: true, image_input: true } },
      { id: 'rwkv', context_length: 16384 },
      { id: 'kokoro', features: { audio_output: true } },
      { id: 'judge', context_length: 32768, features: { classifier: true } },
    ] };
    expect(parseCatalog(connection('featherless'), payload)).toEqual([
      model({ id: 'llama', name: 'llama', input: ['text', 'image'], contextLength: 32768, maxOutput: 4096, tools: true }),
      model({ id: 'rwkv', name: 'rwkv', contextLength: 16384 }),
    ]);
  });

  it('reads Friendli reasoning options, never offers off, and sends a budget in reasoning_budget', () => {
    const payload = { data: [{
      id: 'glm', context_length: 202752, max_completion_tokens: 202752, input_modalities: ['text'], output_modalities: ['text'], reasoning: true,
      functionality: { tool_call: true }, reasoning_options: [{ type: 'toggle' }, { type: 'effort', values: ['high', 'max'] }, { type: 'budget_tokens', min: -1, max: 202752 }],
    }] };
    const friendli = connection('friendli');
    const [glm] = parseCatalog(friendli, payload)!;
    expect(glm).toEqual(model({
      id: 'glm', name: 'glm', input: ['text'], output: ['text'], contextLength: 202752, maxOutput: 202752, reasoning: true, tools: true,
      takes: { settings: null, reasoning: { off: false, levels: ['high', 'max'], budget: { min: null, max: 202752 }, adaptive: null } },
    }));
    const body = JSON.parse(chatRequest(friendli, { model: glm!, messages: [{ role: 'user', content: '안녕' }], settings: { reasoning: { kind: 'budget', tokens: 8000 } } }).body!);
    expect(body).toMatchObject({ reasoning_budget: 8000 });
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('normalizes unknown request capabilities once for both protocol catalogs', () => {
    const generic = connection('generic', { baseUrl: 'https://api.example.com/v1', protocol: 'chat-completions' });
    const payload = { data: [{ id: 'm' }] };
    expect(parseCatalog(generic, payload)![0]!.takes).toEqual({ settings: null, reasoning: null });
    expect(parseCatalog(connection('anthropic'), payload)![0]!.takes).toEqual({ settings: null, reasoning: null });
  });

  it('knows nothing of a type from a newer version, or a generic connection without its address', () => {
    expect(resolveConnection({ type: 'someday', label: '', baseUrl: null, protocol: null, secret: '', starred: [] })).toBeNull();
    expect(resolveConnection({ type: 'generic', label: '', baseUrl: null, protocol: 'chat-completions', secret: '', starred: [] })).toBeNull();
    const newer = { type: 'generic', label: '', baseUrl: 'https://api.example.com/v1', protocol: 'responses', secret: '', starred: [] };
    expect(resolveConnection(newer as unknown as Connection)).toBeNull();
  });
});

describe('meters', () => {
  const meters = openRouter.meters!;

  it('reads an OpenRouter key: its cap, what it spent, and the free model requests', () => {
    expect(meters.request('sk-or-v1-x')).toMatchObject({ url: 'https://openrouter.ai/api/v1/key', method: 'GET', headers: { authorization: 'Bearer sk-or-v1-x' } });
    expect(meters.parse(openRouterKey)).toEqual([
      { kind: 'left', label: '이 키 한도', unit: 'usd', amount: 74.5, limit: 100, resets: 'monthly' },
      { kind: 'spent', label: '이번 달 쓴 돈', unit: 'usd', amount: 25.5 },
      { kind: 'spent', label: '지금까지 쓴 돈', unit: 'usd', amount: 25.5 },
      { kind: 'left', label: '무료 모델 요청', unit: 'requests', amount: 38, limit: 50, resets: 'daily' },
    ]);
  });

  it('shows no cap for a key without one, and leaves out what the answer does not carry', () => {
    const data = { ...openRouterKey.data, limit: null, limit_remaining: null, limit_reset: null, usage_monthly: 'n/a', free_model_daily_requests: undefined };
    expect(meters.parse({ data })).toEqual([
      { kind: 'spent', label: '지금까지 쓴 돈', unit: 'usd', amount: 25.5 },
    ]);
    expect(meters.parse({ error: { message: 'User not found.', code: 401 } })).toBeNull();
  });
});

describe('nanogpt', () => {
  it('reads the balance with the key in x-api-key', () => {
    const { meters } = nanogpt;
    expect(meters!.request('k')).toEqual({ url: 'https://api.nano-gpt.com/api/check-balance', method: 'POST', headers: { 'x-api-key': 'k' }, body: null });
    expect(meters!.parse({ usd_balance: '129.46956147', nano_balance: '26.7' })).toEqual([{ kind: 'left', label: '잔액', unit: 'usd', amount: 129.46956147, limit: null, resets: null }]);
  });
});

describe('vercel', () => {
  it('reads the team balance from decimal strings, and a booked cost by generation id', () => {
    const { meters, settle } = vercel;
    expect(meters!.request('vck_x')).toMatchObject({ url: 'https://ai-gateway.vercel.sh/v1/credits', headers: { authorization: 'Bearer vck_x' } });
    expect(meters!.parse({ balance: '95.50', total_used: '4.50' })).toEqual([
      { kind: 'left', label: '잔액', unit: 'usd', amount: 95.5, limit: null, resets: null },
      { kind: 'spent', label: '지금까지 쓴 돈', unit: 'usd', amount: 4.5 },
    ]);
    expect(meters!.parse({ balance: '', total_used: 'lots' })).toEqual([]);
    expect(settle!.request('vck_x', 'gen_01K').url).toBe('https://ai-gateway.vercel.sh/v1/generation?id=gen_01K');
    expect(settle!.parse({ data: { id: 'gen_01K', total_cost: 0.00123 } })).toEqual({ unit: 'usd', amount: 0.00123, source: 'reported' });
    expect(settle!.parse({ data: { id: 'gen_01K' } })).toBeNull();
  });
});

describe('chat requests', () => {
  const messages = [
    { role: 'system' as const, content: '짧게 답해.' },
    { role: 'user' as const, content: '안녕' },
  ];

  it('sends OpenAI the output limit as max_completion_tokens, never max_tokens', () => {
    const openai = connection('openai');
    const body = JSON.parse(chatRequest(openai, { model: model(), messages, settings: { maxOutput: 1000 } }).body!);
    expect(body).toMatchObject({ max_completion_tokens: 1000 });
    expect(body).not.toHaveProperty('max_tokens');
  });

  it('sends max_tokens to a compatible server only when asked', () => {
    const generic = connection('generic', { baseUrl: 'https://api.example.com/v1', protocol: 'chat-completions' });
    const request = withCredential(generic, chatRequest(generic, { model: model(), messages, settings: {} }), '');
    expect(request).toMatchObject({ url: 'https://api.example.com/v1/chat/completions', headers: { 'content-type': 'application/json' } });
    expect(request.headers).not.toHaveProperty('authorization');
    expect(JSON.parse(request.body!)).toEqual({ model: 'm', messages, stream: true, stream_options: { include_usage: true } });
  });

  it('moves system text to Anthropic’s system field and needs a known output limit', () => {
    const anthropic = connection('anthropic');
    const request = withCredential(anthropic, chatRequest(anthropic, { model: model({ maxOutput: 64000 }), messages, settings: {} }), 'sk-ant');
    expect(request.headers).toEqual({ 'x-api-key': 'sk-ant', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' });
    expect(JSON.parse(request.body!)).toEqual({ model: 'm', max_tokens: 64000, system: '짧게 답해.', messages: [messages[1]], stream: true });
    expect(() => chatRequest(anthropic, { model: model(), messages, settings: {} })).toThrow(ConnectorError);
  });

  it('asks both formats for the whole reply when streaming is off, with no stream options', () => {
    const generic = connection('generic', { baseUrl: 'https://api.example.com/v1', protocol: 'chat-completions' });
    const anthropic = connection('anthropic');
    const off = { model: model({ maxOutput: 64000 }), messages, settings: { streaming: false as const } };
    expect(JSON.parse(chatRequest(generic, off).body!)).toEqual({ model: 'm', messages, stream: false });
    expect(JSON.parse(chatRequest(anthropic, off).body!)).toMatchObject({ stream: false });
  });

  it('reads a request for the cache in the order its wire sends it, with the points it keeps', () => {
    const sent = [{ role: 'user' as const, content: '안녕', cache: true as const }, { role: 'system' as const, content: '짧게 답해.', cache: true as const }];
    const generic = connection('generic', { baseUrl: 'https://api.example.com/v1', protocol: 'chat-completions' });
    expect(cacheView(generic, { model: model(), messages: sent, settings: {} })).toMatchObject({ cache: null, messages: [{ index: 0 }, { index: 1 }] });
    const view = cacheView(connection('anthropic'), { model: model(), messages: sent, settings: { cache: '1h' } });
    expect(view).toMatchObject({ model: 'm', cache: '1h', messages: [{ role: 'system', index: 1, cache: true }, { role: 'user', index: 0, cache: true }] });
  });
});

// The fixture is assembled from the field shapes provider-hub and copilot-manager read, not captured
// from a live account.
describe('copilot', () => {
  const resolved = connection('copilot', { secret: 'gho_x' });
  const models = parseCatalog(resolved, copilotModels)!;
  const find = (id: string) => models.find((entry) => entry.id === id)!;
  const messages = [{ role: 'user' as const, content: '안녕' }];
  const identity = {
    authorization: 'Bearer tid',
    'copilot-integration-id': 'vscode-chat',
    'editor-version': 'vscode/1.109.2',
    'editor-plugin-version': 'copilot-chat/0.37.4',
    'user-agent': 'GitHubCopilotChat/0.37.4',
  };

  it('lists the chat models the model picker offers, each with the protocol it declares', () => {
    const takes = (reasoning: object) => ({ settings: null, reasoning: { off: null, levels: null, budget: null, adaptive: null, ...reasoning } });
    const efforts = takes({ levels: ['low', 'medium', 'high'] });
    expect(models).toEqual([
      {
        id: 'claude-opus-4.6',
        name: 'Claude Opus 4.6',
        input: ['text', 'image'],
        output: ['text'],
        contextLength: 200000,
        maxOutput: 64000,
        reasoning: true,
        tools: true,
        protocol: 'anthropic-messages',
        takes: takes({ budget: { min: 1024, max: 32000 }, adaptive: true }),
      },
      { id: 'gpt-5-mini', name: 'GPT-5 mini', input: ['text', 'image'], output: ['text'], contextLength: 264000, maxOutput: 64000, reasoning: true, tools: true, protocol: 'chat-completions', takes: efforts },
      { id: 'gpt-5.1-codex', name: 'GPT-5.1-Codex', input: ['text', 'image'], output: ['text'], contextLength: 400000, maxOutput: 128000, reasoning: true, tools: true, protocol: 'unsupported', takes: efforts },
      { id: 'gpt-4.1', name: 'GPT-4.1', input: ['text'], output: ['text'], contextLength: 128000, maxOutput: 16384, reasoning: null, tools: true, protocol: null, takes: takes({}) },
    ]);
  });

  it('sends each model to its own endpoint with the editor identity and the exchanged token only', () => {
    expect(withCredential(resolved, resolved.codec.listModels(resolved.endpoint), 'tid')).toEqual({ url: 'https://api.githubcopilot.com/models', method: 'GET', headers: identity, body: null });

    const claude = resolveModel(resolved, find('claude-opus-4.6'));
    const request = withCredential(claude, chatRequest(claude, { model: find('claude-opus-4.6'), messages, settings: {} }), 'tid');
    expect(request.url).toBe('https://api.githubcopilot.com/v1/messages');
    expect(request.headers).toEqual({ ...identity, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' });
    expect(JSON.parse(request.body!)).toMatchObject({ model: 'claude-opus-4.6', max_tokens: 64000 });

    for (const id of ['gpt-5-mini', 'gpt-4.1']) {
      const route = resolveModel(resolved, find(id));
      expect(chatRequest(route, { model: find(id), messages, settings: {} }).url).toBe('https://api.githubcopilot.com/chat/completions');
    }
  });

  it('refuses a model it has no codec for, including a protocol a newer version stored', () => {
    expect(() => resolveModel(resolved, find('gpt-5.1-codex'))).toThrow(new ConnectorError('unsupported-protocol'));
    const newer = { ...find('gpt-4.1'), protocol: 'responses' } as unknown as Model;
    expect(() => resolveModel(resolved, newer)).toThrow(new ConnectorError('unsupported-protocol'));
  });

  it('reads the allowance model use draws on, and no figure for an unlimited plan', () => {
    const { meters } = copilot;
    expect(meters!.request('gho_x')).toMatchObject({ url: 'https://api.github.com/copilot_internal/user', headers: { authorization: 'Bearer gho_x' } });
    const snapshot = { entitlement: 1500, quota_remaining: 1287.5, remaining: 1287, unlimited: false };
    expect(meters!.parse({ token_based_billing: true, quota_reset_date: '2026-10-01', quota_snapshots: { premium_interactions: snapshot } })).toEqual([
      { kind: 'left', label: 'AI 크레딧', unit: 'credit', amount: 1287.5, limit: 1500, resets: { at: Date.UTC(2026, 9, 1) } },
    ]);
    expect(meters!.parse({ quota_snapshots: { premium_interactions: { entitlement: 300, remaining: -4, unlimited: false } } })).toEqual([
      { kind: 'left', label: '프리미엄 요청', unit: 'requests', amount: 0, limit: 300, resets: null },
    ]);
    expect(meters!.parse({ quota_snapshots: { premium_interactions: { unlimited: true, has_quota: true } } })).toEqual([]);
    expect(meters!.parse({ message: 'Not Found' })).toBeNull();
  });

  it('trades the GitHub token for a Copilot token and names the account', () => {
    expect(copilot.exchange!.request('gho_x')).toMatchObject({
      url: 'https://api.github.com/copilot_internal/v2/token',
      headers: { authorization: 'Bearer gho_x', 'user-agent': 'GitHubCopilotChat/0.37.4' },
    });
    expect(copilot.exchange!.parse({ token: 'tid', expires_at: 1_790_000_000, refresh_in: 1500 })).toEqual({ value: 'tid', expiresAt: 1_790_000_000_000 });
    expect(copilot.exchange!.parse({ message: 'Not Found' })).toBeNull();
    expect(copilot.signIn!.account.parse({ login: 'jiniill', id: 1 })).toBe('jiniill');
    expect(copilot.signIn!.account.parse({ login: '' })).toBeNull();
  });
});
