import { describe, expect, it } from 'vitest';
import type { Connection } from '../connectors/types';
import openRouterKey from '../connectors/fixtures/openrouter-key.json';
import openRouterModels from '../connectors/fixtures/openrouter-models.json';
import { SETTINGS_ID } from '../model/settings';
import { addConnection, setStarred } from './connections';
import { stubRelay, testServer, upstream } from './testing';

const server = testServer();

const openRouter: Connection = { type: 'openrouter', label: 'OpenRouter', baseUrl: null, protocol: null, secret: 'sk-or-v1-x', starred: [] };
const KEY = 'https://openrouter.ai/api/v1/key';

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
  it('makes the first model starred the 대화 모델, and leaves one already set alone', () =>
    server.withSession(async ({ store }) => {
      const saved = await store.create('connection', openRouter);
      const id = saved.ok ? saved.data.id : '';
      const model = (name: string) => ({ id: name, name, contextLength: null, maxOutput: null }) as never;
      await setStarred(store, id, model('first'), true);
      await setStarred(store, id, model('second'), true);
      expect(store.get('settings', SETTINGS_ID)?.value.models.main).toEqual({ connection: id, model: 'first' });
    }));
});
