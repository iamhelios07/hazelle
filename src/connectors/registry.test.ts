import { describe, expect, it } from 'vitest';
import { copilot } from './copilot';
import copilotModels from './fixtures/copilot-models.json';
import openRouterModels from './fixtures/openrouter-models.json';
import {
  catalogRequest,
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
  ...extra,
});

describe('detection', () => {
  it('recognizes built-in keys and hosts', () => {
    expect(detect('  sk-or-v1-abc  ')).toMatchObject({ kind: 'key', type: { id: 'openrouter' }, secret: 'sk-or-v1-abc' });
    expect(detect('sk-ant-api03-xyz')).toMatchObject({ kind: 'key', type: { id: 'anthropic' } });
    expect(detect('https://openrouter.ai/api/v1/chat/completions')).toMatchObject({ kind: 'url', type: { id: 'openrouter' } });
  });

  it('takes any other address as a generic connection and flags ones the relay cannot reach', () => {
    expect(detect('https://api.deepseek.com/v1/')).toEqual({ kind: 'generic-url', baseUrl: 'https://api.deepseek.com/v1', problem: null });
    expect(detect('http://example.com/v1')).toMatchObject({ problem: 'not-https' });
    expect(detect('https://localhost:11434/v1')).toMatchObject({ problem: 'local' });
    expect(detect('https://192.168.0.10/v1')).toMatchObject({ problem: 'local' });
    expect(detect('https://my-nas.local/v1')).toMatchObject({ problem: 'local' });
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
    expect(ids('open')).toEqual(['openrouter']);
    expect(ids('Claude')).toEqual(['anthropic', 'copilot']);
    expect(ids('sk-1234')).toBe('none');
  });

  it('hands an address saved as a direct connection to the provider that later claims its host', () => {
    const saved: Connection = { type: 'generic', label: 'openrouter.ai', baseUrl: 'https://openrouter.ai/api/v1', protocol: 'anthropic-messages', secret: 'k', starred: [] };
    expect(resolveConnection(saved)).toMatchObject({ type: { id: 'openrouter' }, endpoint: { baseUrl: 'https://openrouter.ai/api/v1', protocol: 'chat-completions' } });
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
      },
      expect.objectContaining({ id: 'openrouter/auto-beta', name: 'Auto Router (Beta)', output: ['text', 'image'] }),
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
      { id: 'claude-opus-5', name: 'Claude Opus 5', input: ['text', 'image'], output: ['text'], contextLength: null, maxOutput: 128000, reasoning: true, tools: null, protocol: null },
    ]);
  });

  it('reads a generic list as ids with every capability unknown', () => {
    const generic = connection('generic', { baseUrl: 'https://api.example.com/v1', protocol: 'chat-completions' });
    expect(withCredential(generic, catalogRequest(generic), 'k')).toEqual({ url: 'https://api.example.com/v1/models', method: 'GET', headers: { authorization: 'Bearer k' }, body: null });
    expect(parseCatalog(generic, { data: [{ id: 'deepseek-chat' }, { id: '' }, 'junk'] })).toEqual([model({ id: 'deepseek-chat', name: 'deepseek-chat' })]);
    expect(parseCatalog(generic, { models: [] })).toBeNull();
  });

  it('knows nothing of a type from a newer version, or a generic connection without its address', () => {
    expect(resolveConnection({ type: 'someday', label: '', baseUrl: null, protocol: null, secret: '', starred: [] })).toBeNull();
    expect(resolveConnection({ type: 'generic', label: '', baseUrl: null, protocol: 'chat-completions', secret: '', starred: [] })).toBeNull();
    const newer = { type: 'generic', label: '', baseUrl: 'https://api.example.com/v1', protocol: 'responses', secret: '', starred: [] };
    expect(resolveConnection(newer as unknown as Connection)).toBeNull();
  });
});

describe('chat requests', () => {
  const messages = [
    { role: 'system' as const, content: '짧게 답해.' },
    { role: 'user' as const, content: '안녕' },
  ];

  it('sends max_tokens to a compatible server only when asked', () => {
    const generic = connection('generic', { baseUrl: 'https://api.example.com/v1', protocol: 'chat-completions' });
    const request = withCredential(generic, chatRequest(generic, { model: model(), messages, maxTokens: null }), '');
    expect(request).toMatchObject({ url: 'https://api.example.com/v1/chat/completions', headers: { 'content-type': 'application/json' } });
    expect(request.headers).not.toHaveProperty('authorization');
    expect(JSON.parse(request.body!)).toEqual({ model: 'm', messages, stream: true, stream_options: { include_usage: true } });
  });

  it('moves system text to Anthropic’s system field and needs a known output limit', () => {
    const anthropic = connection('anthropic');
    const request = withCredential(anthropic, chatRequest(anthropic, { model: model({ maxOutput: 64000 }), messages, maxTokens: null }), 'sk-ant');
    expect(request.headers).toEqual({ 'x-api-key': 'sk-ant', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' });
    expect(JSON.parse(request.body!)).toEqual({ model: 'm', max_tokens: 64000, system: '짧게 답해.', messages: [messages[1]], stream: true });
    expect(() => chatRequest(anthropic, { model: model(), messages, maxTokens: null })).toThrow(ConnectorError);
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
    expect(models).toEqual([
      { id: 'claude-opus-4.6', name: 'Claude Opus 4.6', input: ['text', 'image'], output: ['text'], contextLength: 200000, maxOutput: 64000, reasoning: true, tools: true, protocol: 'anthropic-messages' },
      { id: 'gpt-5-mini', name: 'GPT-5 mini', input: ['text', 'image'], output: ['text'], contextLength: 264000, maxOutput: 64000, reasoning: true, tools: true, protocol: 'chat-completions' },
      { id: 'gpt-5.1-codex', name: 'GPT-5.1-Codex', input: ['text', 'image'], output: ['text'], contextLength: 400000, maxOutput: 128000, reasoning: true, tools: true, protocol: 'unsupported' },
      { id: 'gpt-4.1', name: 'GPT-4.1', input: ['text'], output: ['text'], contextLength: 128000, maxOutput: 16384, reasoning: null, tools: true, protocol: null },
    ]);
  });

  it('sends each model to its own endpoint with the editor identity and the exchanged token only', () => {
    expect(withCredential(resolved, catalogRequest(resolved), 'tid')).toEqual({ url: 'https://api.githubcopilot.com/models', method: 'GET', headers: identity, body: null });

    const claude = resolveModel(resolved, find('claude-opus-4.6'));
    const request = withCredential(claude, chatRequest(claude, { model: find('claude-opus-4.6'), messages, maxTokens: null }), 'tid');
    expect(request.url).toBe('https://api.githubcopilot.com/v1/messages');
    expect(request.headers).toEqual({ ...identity, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' });
    expect(JSON.parse(request.body!)).toMatchObject({ model: 'claude-opus-4.6', max_tokens: 64000 });

    for (const id of ['gpt-5-mini', 'gpt-4.1']) {
      const route = resolveModel(resolved, find(id));
      expect(chatRequest(route, { model: find(id), messages, maxTokens: null }).url).toBe('https://api.githubcopilot.com/chat/completions');
    }
  });

  it('refuses a model it has no codec for, including a protocol a newer version stored', () => {
    expect(() => resolveModel(resolved, find('gpt-5.1-codex'))).toThrow(new ConnectorError('unsupported-protocol'));
    const newer = { ...find('gpt-4.1'), protocol: 'responses' } as unknown as Model;
    expect(() => resolveModel(resolved, newer)).toThrow(new ConnectorError('unsupported-protocol'));
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
