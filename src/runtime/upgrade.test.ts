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
});
