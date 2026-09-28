import { describe, expect, it } from 'vitest';
import type { Connection, Model } from '../connectors/types';
import openRouterKey from '../connectors/fixtures/openrouter-key.json';
import openRouterModels from '../connectors/fixtures/openrouter-models.json';
import { addConnection, clearModelSetting, clearModelSettings, setModelSettings } from './connections';
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

describe('model settings', () => {
  it('merges each change into what is stored, so another device’s change to another field survives', async () => {
    const { store, open } = await server.account();
    const model: Model = { id: 'm', name: 'M', input: null, output: null, contextLength: null, maxOutput: null, reasoning: null, tools: null, protocol: null };
    const created = await store.create('connection', { ...openRouter, starred: [model, { ...model, id: 'other' }] });
    const id = created.ok ? created.data.id : '';
    const other = await open();
    await other.pull();
    const starred = () => store.get('connection', id)!.value.starred;

    await setModelSettings(store, id, 'm', { temperature: 1, stop: ['끝'] });
    await setModelSettings(other, id, 'm', { maxOutput: 6000 });
    await store.pull();
    expect(starred()).toEqual([{ ...model, settings: { temperature: 1, stop: ['끝'], maxOutput: 6000 } }, { ...model, id: 'other' }]);

    await clearModelSetting(store, id, 'm', 'stop');
    expect(starred()[0]!.settings).toEqual({ temperature: 1, maxOutput: 6000 });
    await clearModelSettings(store, id, 'm');
    expect(starred()[0]).toEqual(model);
  });
});
