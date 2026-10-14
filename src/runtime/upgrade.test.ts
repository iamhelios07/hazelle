import { describe, expect, it, vi } from 'vitest';
import { memoryId } from '../model/memory';
import { startChat } from './chat-log';
import { testServer } from './testing';
import { readRow, saveUpgraded, upgradeValue } from './upgrade';

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

  it("gives a character's and a module's scripts ids by place, and turns 상태창 지정's places into those ids", () => {
    const script = (name: string) => ({ name, find: name, replace: '', stage: 'display', flags: null });
    const card = { name: '루나', regex: [script('a'), script('b')], triggers: [{ kind: 'lua', name: 'main', code: 'x()' }] };
    expect(upgradeValue('character', { card, statusScripts: [1, 5] })).toEqual({
      card: { ...card, regex: [{ ...script('a'), id: 'regex-0' }, { ...script('b'), id: 'regex-1' }], triggers: [{ kind: 'lua', name: 'main', code: 'x()', id: 'trigger-0' }] },
      statusScripts: ['regex-1'],
    });
    expect(upgradeValue('character', { card, greetingTranslations: [] })).toMatchObject({ translations: [], card: { regex: [{ id: 'regex-0' }, { id: 'regex-1' }] } });
    expect(upgradeValue('module', { name: 'Bell', regex: [script('a')], triggers: [] })).toEqual({ name: 'Bell', regex: [{ ...script('a'), id: 'regex-0' }], triggers: [] });
  });

  it('reads a place a tab on the old build added among ids through the card as it stands, once each', () => {
    const regex = [{ id: 'new', name: 'n' }, { id: 'regex-0', name: 'a' }];
    expect(upgradeValue('character', { card: { regex, triggers: [] }, statusScripts: ['regex-0', 0, 1] })).toEqual({ card: { regex, triggers: [] }, statusScripts: ['regex-0', 'new'] });
  });

  it('drops the translation switches a character kept before they were shared, and leaves its own', () => {
    expect(upgradeValue('character', { folder: null, translate: { replies: true }, ownTranslate: { replies: false } })).toEqual({ folder: null, ownTranslate: { replies: false } });
  });

  it('drops 옆에 두기 from a character', () => {
    expect(upgradeValue('character', { folder: null, keepStatus: true })).toEqual({ folder: null });
  });

  it("reads a character's and a module's opaque block effects again once this app runs them, and leaves loops opaque", () => {
    const concat = { type: 'v2ConcatString', source1: 'a', source1Type: 'value', source2: 'b', source2Type: 'value', outputVar: 'ab', indent: 0 };
    const loop = { type: 'v2LoopNTimes', value: '2', valueType: 'value', indent: 0 };
    const trigger = { id: 'trigger-0', kind: 'blocks', name: 'go', on: 'manual', conditions: [], effects: [{ kind: 'opaque', type: 'v2ConcatString', raw: concat }, { kind: 'opaque', type: 'v2LoopNTimes', raw: loop }] };
    const effects = [{ kind: 'call', type: 'v2ConcatString', inputs: [{ kind: 'text', text: 'a' }, { kind: 'text', text: 'b' }], name: '', output: 'ab', option: '' }, trigger.effects[1]];
    expect(upgradeValue('character', { card: { regex: [], triggers: [trigger] } })).toEqual({ card: { regex: [], triggers: [{ ...trigger, effects }] } });
    expect(upgradeValue('module', { regex: [], triggers: [trigger] })).toEqual({ regex: [], triggers: [{ ...trigger, effects }] });
    expect(upgradeValue('module', { regex: [], triggers: [{ ...trigger, effects: [trigger.effects[1]] }] })).toBeNull();
  });

  it('leaves a current character or module alone, so the write-back touches only old ones', () => {
    expect(upgradeValue('character', { folder: null, card: { regex: [], triggers: [] } })).toBeNull();
    expect(upgradeValue('character', { card: { regex: [{ id: 'x' }], triggers: [{ id: 'y' }] }, statusScripts: ['x'] })).toBeNull();
    expect(upgradeValue('module', { regex: [{ id: 'x' }], triggers: [] })).toBeNull();
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

  it('writes a module whose scripts had no ids back once, with them', async () => {
    const { store, open } = await server.account();
    const old = { name: 'Bell', description: '', namespace: null, regex: [{ name: 'a', find: 'a', replace: '', stage: 'display', flags: null }], triggers: [], toggles: '', loreFolders: [] };
    const created = await store.create('module', old as never);
    if (!created.ok) throw new Error(created.error);
    const other = await open();
    await other.pull();
    await saveUpgraded(other);
    const third = await open();
    await third.pull();
    expect(third.get('module', created.data.id)?.value.regex).toEqual([{ ...old.regex[0], id: 'regex-0' }]);
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


it('upgrades old encrypted ledger and stream values through the backup/restore reader, never inventing a denominator or rewriting append-only rows', async () => {
  const call = { id: crypto.randomUUID(), connection: 'connection', source: 'Source', model: 'm', modelName: 'M', usage: { inputTokens: 123 }, cost: null };
  const oldLedger = { id: crypto.randomUUID(), kind: 'ledger', parent: 'settings', rev: 1, value: { type: 'call', call, at: 10, chat: null, character: null } };
  const oldStream = { id: crypto.randomUUID(), kind: 'stream', parent: 'chat', rev: 2, value: { key: {}, call, at: 10, result: 'reply', for: { kind: 'reply', message: null, replaces: null, continues: null } } };
  const unavailable = { measurement: { kind: 'unavailable', reason: 'historical' }, fit: null, retries: [], eligible: false };
  expect(readRow(JSON.parse(JSON.stringify(oldLedger)))?.value).toMatchObject({ call: { usage: { inputTokens: 123 }, calibration: unavailable } });
  expect(readRow(JSON.parse(JSON.stringify(oldStream)))?.value).toMatchObject({ calibration: unavailable });
  const current = readRow(oldLedger)!;
  expect(upgradeValue('ledger', current.value)).toBeNull();
  expect(readRow(JSON.parse(JSON.stringify(current)))).toEqual(current);
  expect(upgradeValue('stream', readRow(oldStream)!.value)).toBeNull();
  const { store } = await server.account();
  const take = vi.spyOn(store, 'takeUpgraded').mockReturnValue([{ id: oldLedger.id, kind: 'ledger' }]);
  const update = vi.spyOn(store, 'update');
  await saveUpgraded(store);
  expect(update).not.toHaveBeenCalled();
  take.mockRestore();
  update.mockRestore();
});
