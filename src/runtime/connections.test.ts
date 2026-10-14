import { describe, expect, it } from 'vitest';
import { CONNECTION_TYPES, RETRIES } from '../connectors/registry';
import type { Connection, Model } from '../connectors/types';
import openRouterKey from '../connectors/fixtures/openrouter-key.json';
import openRouterModels from '../connectors/fixtures/openrouter-models.json';
import { SETTINGS_ID } from '../model/settings';
import { addConnection, providerConnection, refreshStarred, retriesOf, setSharedRetries, setStarred } from './connections';
import { stubRelay, testServer, upstream } from './testing';

const server = testServer();

const openRouter: Connection = { type: 'openrouter', label: 'OpenRouter', baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'sk-or-v1-x' }], turns: null, starred: [] };
const KEY = 'https://openrouter.ai/api/v1/key';

describe('providerConnection', () => {
  it('holds one account, named only for a sign-in, and gives a pool type its first group', () => {
    const type = CONNECTION_TYPES.find((entry) => entry.id === 'openrouter')!;
    expect(providerConnection(type, 'sk-or-v1-x')).toEqual({ ...openRouter, accounts: [{ id: expect.any(String), secret: 'sk-or-v1-x' }] });
    const copilot = providerConnection(CONNECTION_TYPES.find((entry) => entry.id === 'copilot')!, 'gho_x', 'jin');
    expect(copilot).toMatchObject({ accounts: [{ secret: 'gho_x', name: 'jin' }], turns: { day: 16, groups: [{ name: '그룹 1', accounts: [copilot.accounts[0]!.id] }] } });
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

  it('numbers a label another connection already holds', () =>
    server.withSession(async (session) => {
      stubRelay(({ url }) => upstream(200, url === KEY ? openRouterKey : openRouterModels));
      await addConnection(session, openRouter);
      await addConnection(session, openRouter);
      await addConnection(session, openRouter);
      expect(session.store.list('connection').map(({ value }) => value.label).sort()).toEqual(['OpenRouter', 'OpenRouter 2', 'OpenRouter 3']);
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

describe('refreshStarred', () => {
  it('takes what the list says of each starred model now, keeping its 설정 묶음, a price and inputs the list leaves out, and a model it no longer lists', () =>
    server.withSession(async ({ store }) => {
      const base: Model = { id: 'm', name: 'M', input: null, output: null, contextLength: null, maxOutput: null, reasoning: null, tools: null, protocol: null, takes: { settings: null, reasoning: null } };
      const price = { input: 1, output: 2, cacheRead: null, cacheWrite: null, tiers: [] };
      const saved = await store.create('connection', { ...openRouter, starred: [{ ...base, input: ['text', 'image'], price, profile: 'p' }, { ...base, id: 'gone' }] });
      const id = saved.ok ? saved.data.id : '';
      const listed = { ...base, name: 'M 2', protocol: 'anthropic-messages' as const, later: 'a field a later version adds' };
      await refreshStarred(store, id, [listed]);
      expect(store.get('connection', id)?.value.starred).toEqual([{ ...listed, input: ['text', 'image'], price, profile: 'p' }, { ...base, id: 'gone' }]);
      const rev = store.get('connection', id)!.rev;
      await refreshStarred(store, id, [{ ...listed }]);
      expect(store.get('connection', id)!.rev).toBe(rev);
    }));
});

describe('retriesOf', () => {
  it("takes the model's 설정 묶음 first, then its connection, then the shared count, else the default", () =>
    server.withSession(async ({ store }) => {
      expect(retriesOf(store, openRouter, {})).toBe(RETRIES);
      await setSharedRetries(store, 4);
      expect(retriesOf(store, openRouter, {})).toBe(4);
      expect(retriesOf(store, { ...openRouter, retries: 0 }, {})).toBe(0);
      expect(retriesOf(store, { ...openRouter, retries: 0 }, { retries: 5 })).toBe(5);
    }));
});
