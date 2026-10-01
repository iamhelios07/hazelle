import { describe, expect, it, vi } from 'vitest';
import type { Connection } from '../connectors/types';
import type { Lore } from '../model/library';
import { emptyMemory } from '../model/memory';
import { randomBytes, toBase64 } from '../vault/aead';
import { api } from './api';
import { ObjectStore, type Write } from './store';
import { BATCH_LIMITS, testServer } from './testing';

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

  it('keeps kind and parent reads in order through local and pulled replacements, removals and restores', async () => {
    const { store, open } = await server.account();
    const phone = await open();
    const parent = crypto.randomUUID();
    const otherParent = crypto.randomUUID();
    const first = await store.create('entry', { type: 'delete', message: 'first', at: 0 }, { parent });
    const memory = await store.create('memory', emptyMemory(), { parent });
    const second = await store.create('entry', { type: 'delete', message: 'second', at: 1 }, { parent });
    const other = await store.create('entry', { type: 'delete', message: 'other', at: 2 }, { parent: otherParent });
    if (!first.ok || !memory.ok || !second.ok || !other.ok) throw new Error('create failed');
    await phone.pull();
    for (const device of [store, phone]) {
      expect(device.list('entry')).toEqual([first.data, second.data, other.data]);
      expect(device.children('entry', parent)).toEqual([first.data, second.data]);
      expect(device.children('memory', parent)).toEqual([memory.data]);
      expect(device.children('entry', otherParent)).toEqual([other.data]);
    }

    expect((await store.restore(first.data)).ok).toBe(true);
    expect((await store.remove(memory.data.id)).ok).toBe(true);
    expect((await store.remove(other.data.id)).ok).toBe(true);
    await phone.pull();
    for (const device of [store, phone]) {
      expect(device.list('entry').map(({ id }) => id)).toEqual([second.data.id, first.data.id]);
      expect(device.children('entry', parent)).toEqual(device.list('entry'));
      expect(device.list('memory')).toEqual([]);
      expect(device.children('memory', parent)).toEqual([]);
      expect(device.children('entry', otherParent)).toEqual([]);
    }

    const restored = await store.restore(other.data);
    if (!restored.ok) throw new Error(restored.error);
    await phone.pull();
    for (const device of [store, phone]) {
      expect(device.children('entry', otherParent)).toEqual([restored.data]);
      expect(device.list('entry').map(({ id }) => id)).toEqual([second.data.id, first.data.id, other.data.id]);
    }
  });

  it('decrypts only pulled objects newer than the revisions already held', async () => {
    const { store, open } = await server.account();
    const local = await store.create('connection', connection('local'));
    if (!local.ok) throw new Error(local.error);
    const phone = await open();
    await phone.pull();
    const remote = await phone.create('connection', connection('remote'));
    if (!remote.ok) throw new Error(remote.error);

    const decrypt = vi.spyOn(crypto.subtle, 'decrypt');
    try {
      await store.pull();
      expect(decrypt).toHaveBeenCalledTimes(1);
      expect(store.list('connection')).toEqual([local.data, remote.data]);
    } finally {
      decrypt.mockRestore();
    }
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

    expect((await stranger.update('connection', id, renamed('z'))).ok).toBe(true);
    await mine.pull();
    expect(mine.unreadable()).toBe(1);
    expect((await stranger.remove(id)).ok).toBe(true);
    await mine.pull();
    expect(mine.unreadable()).toBe(0);
    if (!created.ok) throw new Error(created.error);
    expect((await mine.restore(created.data)).ok).toBe(true);
    expect(mine.unreadable()).toBe(0);
    expect(mine.list('connection').map(({ id }) => id)).toEqual([id]);
  });

  it('retries the whole batch after a later removal conflicts, without spending revs on the refused attempt', async () => {
    const { store: laptop, open } = await server.account();
    const a = await laptop.create('connection', connection('a'));
    const b = await laptop.create('connection', connection('b'));
    if (!a.ok || !b.ok) throw new Error('create failed');
    const phone = await open();
    await phone.pull();
    await laptop.update('connection', b.data.id, renamed('c'));

    expect(await phone.batch([
      { ...a.data, type: 'restore', value: connection('changed') },
      { type: 'remove', id: b.data.id },
    ])).toEqual({ ok: true, data: null });
    expect(phone.get('connection', a.data.id)).toMatchObject({ rev: 4, value: connection('changed') });
    await laptop.pull();
    expect(laptop.get('connection', a.data.id)).toEqual(phone.get('connection', a.data.id));
    expect(laptop.get('connection', b.data.id)).toBeNull();
  });

  it('splits by sealed request bytes, with the owner last and progress after each acknowledged object', async () => {
    const { accountId, vaultKey } = await server.account();
    const batches: { writes: { id: string; body: string }[] }[] = [];
    const request = async <T,>(...args: Parameters<typeof api>) => {
      if (args[1] === 'objects/batch') batches.push(args[2] as (typeof batches)[number]);
      return api<T>(...args);
    };
    const store = await ObjectStore.open(accountId, vaultKey, request);
    const id = crypto.randomUUID();
    const text = Array.from({ length: 16 }, () => toBase64(randomBytes(65_535))).join('');
    const writes: Write[] = [
      { type: 'create', kind: 'chat', id, parent: null, value: { title: null, character: null, models: {} } },
      ...Array.from({ length: 3 }, (_, at): Write => ({ type: 'create', kind: 'entry', id: crypto.randomUUID(), parent: id, value: { type: 'message', role: 'user', at, text, receipt: null } })),
    ];
    const progress: string[] = [];
    expect(await store.batch(writes, (write) => progress.push(write.id))).toEqual({ ok: true, data: null });
    expect(batches.map(({ writes }) => writes.length)).toEqual([2, 2]);
    expect(progress).toEqual([...writes.slice(1), writes[0]!].map(({ id }) => id));
    for (const batch of batches) {
      expect(new TextEncoder().encode(JSON.stringify(batch)).length).toBeLessThanOrEqual(BATCH_LIMITS.bytes);
      expect(batch.writes.every(({ body }) => body.length <= BATCH_LIMITS.body)).toBe(true);
    }
    expect(store.children('entry', id).map(({ value }) => value)).toEqual(writes.slice(1).map((write) => write.type !== 'remove' && write.value));
    expect(store.get('chat', id)?.rev).toBe(4);
  });
});
