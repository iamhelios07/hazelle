import { describe, expect, it } from 'vitest';
import type { Connection } from '../connectors/types';
import type { Lore } from '../model/library';
import { randomBytes } from '../vault/aead';
import { api } from './api';
import { ObjectStore } from './store';
import { testServer } from './testing';

const server = testServer();

const connection = (label: string): Connection => ({ type: 'openrouter', label, baseUrl: null, protocol: null, secret: 'sk-or-x', starred: [] });
const renamed = (suffix: string) => (current: Connection) => ({ ...current, label: current.label + suffix });

describe('object store', () => {
  it('shares writes between devices and reapplies a change after a conflict', async () => {
    const { store: laptop, open } = await server.account();
    const phone = await open();

    const created = await laptop.create('connection', connection('a'));
    const id = created.ok ? created.data.id : '';
    await phone.pull();
    expect(phone.get('connection', id)?.value.label).toBe('a');

    await laptop.update('connection', id, renamed('b'));
    const saved = await phone.update('connection', id, renamed('c'));
    expect(saved.ok && saved.data.value.label).toBe('abc');
    await laptop.pull();
    expect(laptop.get('connection', id)?.value.label).toBe('abc');
  });

  it('never brings back what another device removed, except by restoring it', async () => {
    const { store: laptop, open } = await server.account();
    const phone = await open();
    const created = await laptop.create('connection', connection('a'));
    if (!created.ok) throw new Error(created.error);
    const { id } = created.data;
    await phone.pull();

    expect(await laptop.remove(id)).toEqual({ ok: true, data: null });
    expect(await phone.update('connection', id, renamed('b'))).toEqual({ ok: false, error: 'gone' });
    expect(phone.list('connection')).toEqual([]);

    expect((await phone.restore(created.data)).ok).toBe(true);
    await laptop.pull();
    expect(laptop.get('connection', id)?.value.label).toBe('a');
  });

  it("keeps each object's parent and finds children by it", async () => {
    const { store } = await server.account();
    const chat = await store.create('chat', { title: null, character: null, models: {} });
    if (!chat.ok) throw new Error(chat.error);
    const entry = { type: 'delete', message: 'm', at: 0 } as const;
    const first = await store.create('entry', entry, { parent: chat.data.id });
    expect(first.ok && first.data.parent).toBe(chat.data.id);
    expect(await store.create('entry', entry)).toEqual({ ok: false, error: 'bad-input' });
    expect(await store.create('lore', { name: 'x' } as Lore, { parent: chat.data.id })).toEqual({ ok: false, error: 'bad-input' });
    expect(store.children('entry', chat.data.id).map((child) => child.value)).toEqual([entry]);
  });

  it('answers a create tried again after it landed with the object it made', async () => {
    const { store, open } = await server.account();
    const created = await store.create('connection', connection('a'));
    if (!created.ok) throw new Error(created.error);
    const other = await open();
    expect(await other.create('connection', connection('a'), { id: created.data.id })).toMatchObject({ ok: true, data: { id: created.data.id } });
    expect(await other.create('connection', connection('b'), { id: created.data.id })).toEqual({ ok: false, error: 'conflict' });
  });

  it('keeps a write that lands while a pull is still opening an older copy', async () => {
    const { accountId, vaultKey } = await server.account();
    let meanwhile: (() => Promise<unknown>) | null = null;
    const request = async <T,>(...args: Parameters<typeof api>) => {
      const result = await api<T>(...args);
      const landing = meanwhile;
      meanwhile = null;
      await landing?.();
      return result;
    };
    const store = await ObjectStore.open(accountId, vaultKey, request);
    const created = await store.create('connection', connection('a'));
    if (!created.ok) throw new Error(created.error);
    const { id } = created.data;

    meanwhile = () => store.update('connection', id, renamed('b'));
    await store.pull();
    expect(store.get('connection', id)?.value.label).toBe('ab');
  });

  it('counts a body it cannot open and refuses to overwrite it', async () => {
    const { store: mine, open } = await server.account();
    const stranger = await open(randomBytes(32));
    const created = await stranger.create('connection', connection('x'));
    const id = created.ok ? created.data.id : '';

    await mine.pull();
    expect(mine.list('connection')).toEqual([]);
    expect(mine.unreadable()).toBe(1);
    expect(await mine.update('connection', id, renamed('y'))).toEqual({ ok: false, error: 'unreadable' });
  });
});
