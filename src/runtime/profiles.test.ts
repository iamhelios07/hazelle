import { describe, expect, it } from 'vitest';
import type { Connection, Model } from '../connectors/types';
import { addFirstProfile, addProfile, FIRST_PROFILE_ID, modelProfile, removeProfile, setModelProfile, setProfileSettings } from './profiles';
import { testServer } from './testing';

const server = testServer();

const model: Model = { id: 'm', name: 'M', input: null, output: null, contextLength: null, maxOutput: null, reasoning: null, tools: null, protocol: null, takes: { settings: null, reasoning: null } };
const openRouter: Connection = { type: 'openrouter', label: 'OpenRouter', baseUrl: null, protocol: null, secret: 'sk-or-x', starred: [model, { ...model, id: 'other' }] };

describe('설정 묶음', () => {
  it('gives a model the default 묶음 until it names its own, reads a deleted one as missing, and keeps the default', async () => {
    const { store } = await server.account();
    const created = await store.create('connection', openRouter);
    const id = created.ok ? created.data.id : '';
    const starred = () => store.get('connection', id)!.value.starred[0]!;

    await addFirstProfile(store);
    expect(modelProfile(store, starred())).toMatchObject({ kind: 'profile', own: false, profile: { id: FIRST_PROFILE_ID, value: { name: '기본', settings: {} } } });
    const added = await addProfile(store, { name: 'Claude', settings: { temperature: 1 } });
    const claude = added.ok ? added.data.id : '';
    await setModelProfile(store, id, 'm', claude);
    expect(modelProfile(store, starred())).toMatchObject({ kind: 'profile', own: true, profile: { id: claude } });
    await removeProfile(store, claude);
    expect(modelProfile(store, starred())).toEqual({ kind: 'missing', own: true });
    expect(await removeProfile(store, FIRST_PROFILE_ID)).toEqual({ ok: false, error: 'default' });
  });

  it('merges each change into what is stored, so another device’s change to another field survives', async () => {
    const { store, open } = await server.account();
    const added = await addProfile(store, { name: 'Claude', settings: {} });
    const id = added.ok ? added.data.id : '';
    const other = await open();
    await other.pull();

    await setProfileSettings(store, id, { temperature: 1, stop: ['끝'] });
    await setProfileSettings(other, id, { maxOutput: 6000 });
    await store.pull();
    await setProfileSettings(store, id, { stop: undefined });
    expect(store.get('profile', id)!.value.settings).toEqual({ temperature: 1, maxOutput: 6000 });
  });
});
