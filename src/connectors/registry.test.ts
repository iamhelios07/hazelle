import { describe, expect, it } from 'vitest';
import openRouterModels from './fixtures/openrouter-models.json';
import { catalogRequest, chatRequest, detect, normalizeBaseUrl, parseCatalog, resolveConnection } from './registry';
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
      { id: 'claude-opus-5', name: 'Claude Opus 5', input: ['text', 'image'], output: ['text'], contextLength: null, maxOutput: 128000, reasoning: true, tools: null },
    ]);
  });

  it('reads a generic list as ids with every capability unknown', () => {
    const generic = connection('generic', { baseUrl: 'https://api.example.com/v1', protocol: 'chat-completions' });
    expect(catalogRequest(generic, 'k')).toEqual({ url: 'https://api.example.com/v1/models', method: 'GET', headers: { authorization: 'Bearer k' }, body: null });
    expect(parseCatalog(generic, { data: [{ id: 'deepseek-chat' }, { id: '' }, 'junk'] })).toEqual([model({ id: 'deepseek-chat', name: 'deepseek-chat' })]);
    expect(parseCatalog(generic, { models: [] })).toBeNull();
  });

  it('knows nothing of a type from a newer version, or a generic connection without its address', () => {
    expect(resolveConnection({ type: 'someday', label: '', baseUrl: null, protocol: null, secret: '', starred: [] })).toBeNull();
    expect(resolveConnection({ type: 'generic', label: '', baseUrl: null, protocol: 'chat-completions', secret: '', starred: [] })).toBeNull();
  });
});

describe('chat requests', () => {
  const messages = [
    { role: 'system' as const, content: '짧게 답해.' },
    { role: 'user' as const, content: '안녕' },
  ];

  it('sends max_tokens to a compatible server only when asked', () => {
    const generic = connection('generic', { baseUrl: 'https://api.example.com/v1', protocol: 'chat-completions' });
    const request = chatRequest(generic, '', { model: model(), messages, maxTokens: null });
    expect(request).toMatchObject({ url: 'https://api.example.com/v1/chat/completions', headers: { 'content-type': 'application/json' } });
    expect(request.headers).not.toHaveProperty('authorization');
    expect(JSON.parse(request.body!)).toEqual({ model: 'm', messages, stream: true, stream_options: { include_usage: true } });
  });

  it('moves system text to Anthropic’s system field and needs a known output limit', () => {
    const request = chatRequest(connection('anthropic'), 'sk-ant', { model: model({ maxOutput: 64000 }), messages, maxTokens: null });
    expect(request.headers).toEqual({ 'x-api-key': 'sk-ant', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' });
    expect(JSON.parse(request.body!)).toEqual({ model: 'm', max_tokens: 64000, system: '짧게 답해.', messages: [messages[1]], stream: true });
    expect(() => chatRequest(connection('anthropic'), 'sk-ant', { model: model(), messages, maxTokens: null })).toThrow(ConnectorError);
  });
});
