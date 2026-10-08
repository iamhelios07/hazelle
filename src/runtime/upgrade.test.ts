import { describe, expect, it } from 'vitest';
import { memoryId } from '../model/memory';
import { startChat } from './chat-log';
import { testServer } from './testing';
import { saveUpgraded, upgradeValue } from './upgrade';

const server = testServer();

const old = { type: 'copilot', label: 'Copilot', account: 'jin', baseUrl: null, protocol: null, secret: 'gho_x', starred: [] };
const upgraded = {
  type: 'copilot',
  label: 'Copilot',
  baseUrl: null,
  protocol: null,
  starred: [],
  accounts: [{ id: 'account-1', secret: 'gho_x', name: 'jin' }],
  turns: { day: 16, groups: [{ id: 'group-1', name: '그룹 1', accounts: ['account-1'] }], anchor: { group: 'group-1', cycle: 0 } },
};

describe('upgradeValue', () => {
  it('gives a connection from before accounts its one account, in a first group where the type is a pool', () => {
    expect(upgradeValue('connection', old)).toEqual(upgraded);
    expect(upgradeValue('connection', { ...old, type: 'openrouter', account: undefined })).toMatchObject({ accounts: [{ id: 'account-1', secret: 'gho_x' }], turns: null });
    expect(upgradeValue('connection', upgraded)).toBeNull();
    expect(upgradeValue('folder', { name: 'secret' })).toBeNull();
  });

  it('moves a character’s greeting translations into its text translations', () => {
    const translation = { text: '안녕', receipt: null, at: 1 };
    const character = { folder: null, greetingTranslations: [{ greeting: 'Hello', language: 'Korean', translation }] };
    expect(upgradeValue('character', character)).toEqual({ folder: null, translations: [{ source: 'Hello', language: 'Korean', translation }] });
    expect(upgradeValue('character', { folder: null, translations: [] })).toBeNull();
  });

  it('holds an old connection upgraded as it is read, and writes it back once', async () => {
    const { store, open } = await server.account();
    const created = await store.create('connection', old as never);
    if (!created.ok) throw new Error(created.error);
    const other = await open();
    await other.pull();
    expect(other.get('connection', created.data.id)?.value).toEqual(upgraded);
    await saveUpgraded(other);
    expect(other.takeUpgraded()).toEqual([]);

    const third = await open();
    await third.pull();
    expect(third.get('connection', created.data.id)?.value).toEqual(upgraded);
    expect(third.takeUpgraded()).toEqual([]);
  });

  it('gives a chat memory from before chapters none, and writes it back once its chat is loaded', async () => {
    const memory = { records: [], state: [], threads: [{ id: 't', text: 'They meet again.', opened: null }] };
    expect(upgradeValue('memory', memory)).toEqual({ ...memory, chapters: [] });
    expect(upgradeValue('memory', { ...memory, chapters: [] })).toBeNull();

    const { store, open } = await server.account();
    const chat = crypto.randomUUID();
    await server.hold(store, chat);
    await startChat(store, chat, { title: null, character: null, models: {} }, null);
    await store.create('memory', memory as never, { id: memoryId(chat), parent: chat });
    const other = await open();
    await server.hold(other, chat);
    expect(other.get('memory', memoryId(chat))?.value).toEqual({ ...memory, chapters: [] });
    await saveUpgraded(other);

    const third = await open();
    await server.hold(third, chat);
    expect(third.get('memory', memoryId(chat))?.value).toEqual({ ...memory, chapters: [] });
    expect(third.takeUpgraded()).toEqual([]);
  });
});
