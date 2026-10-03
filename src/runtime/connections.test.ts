import { describe, expect, it } from 'vitest';
import { CONNECTION_TYPES } from '../connectors/registry';
import type { Connection } from '../connectors/types';
import openRouterKey from '../connectors/fixtures/openrouter-key.json';
import openRouterModels from '../connectors/fixtures/openrouter-models.json';
import { SETTINGS_ID } from '../model/settings';
import { addConnection, providerConnection, setStarred } from './connections';
import { stubRelay, testServer, upstream } from './testing';

const server = testServer();

const openRouter: Connection = { type: 'openrouter', label: 'OpenRouter', baseUrl: null, protocol: null, secret: 'sk-or-v1-x', starred: [] };
const KEY = 'https://openrouter.ai/api/v1/key';

describe('providerConnection', () => {
  it('initializes the provider-backed stored shape, with account metadata only for sign-in', () => {
    const type = CONNECTION_TYPES.find((entry) => entry.id === 'openrouter')!;
    expect(providerConnection(type, 'sk-or-v1-x')).toEqual(openRouter);
    expect(providerConnection(type, 'signed-in', '사용자')).toEqual({ ...openRouter, secret: 'signed-in', account: '사용자' });
    const first = providerConnection(type, 'first');
    const second = providerConnection(type, 'second');
    expect(first.starred).not.toBe(second.starred);
  });
});

describe('addConnection', () => {
  it('saves nothing for a key the meters refuse, though the public model list loaded, and answers the new id otherwise', () =>
    server.withSession(async (session) => {
      let key = upstream(401, { error: { message: 'User not found.' } });
      stubRelay(({ url }) => (url === KEY ? key : upstream(200, openRouterModels)));
      expect(await addConnection(session, openRouter)).toMatchObject({ ok: false, failure: { kind: 'key', failure: { kind: 'provider', status: 401 } } });
      expect(session.store.list('connection')).toEqual([]);

      key = upstream(200, openRouterKey);
      const added = await addConnection(session, openRouter);
      expect(session.store.list('connection').map((stored) => [stored.id, stored.value])).toEqual([[added.ok && added.id, openRouter]]);
    }));
});

describe('setStarred', () => {
  it('makes the first starred model that can talk the 대화 모델, and leaves one already set alone', () =>
    server.withSession(async ({ store }) => {
      const saved = await store.create('connection', openRouter);
      const id = saved.ok ? saved.data.id : '';
      const model = (name: string, output: string[] | null = null) => ({ id: name, name, input: null, output, contextLength: null, maxOutput: null, takes: { settings: null, reasoning: null } }) as never;
      await setStarred(store, id, model('painter', ['image']), true);
      await setStarred(store, id, model('first'), true);
      await setStarred(store, id, model('second'), true);
      expect(store.get('settings', SETTINGS_ID)?.value.models.main).toEqual({ connection: id, model: 'first' });
    }));
});
