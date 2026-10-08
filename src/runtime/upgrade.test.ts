import { describe, expect, it } from 'vitest';
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
});
