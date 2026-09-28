import { describe, expect, it } from 'vitest';
import { randomBytes } from '../vault/aead';
import { fakeServer } from './fake-server';
import { ObjectStore } from './store';

const ACCOUNT = 'account-1';

describe('object store', () => {
  it('shares writes between devices and reapplies a change after a conflict', async () => {
    const server = fakeServer();
    const vaultKey = randomBytes(32);
    const laptop = await ObjectStore.open(ACCOUNT, vaultKey, server.request);
    const phone = await ObjectStore.open(ACCOUNT, vaultKey, server.request);

    await laptop.save<{ starred: string[] }>('connection', 'c1', () => ({ starred: ['a'] }));
    await phone.pull();
    expect(phone.get('c1')?.value).toEqual({ starred: ['a'] });

    await laptop.save<{ starred: string[] }>('connection', 'c1', (current) => ({ starred: [...current!.starred, 'b'] }));
    const saved = await phone.save<{ starred: string[] }>('connection', 'c1', (current) => ({ starred: [...current!.starred, 'c'] }));
    expect(saved.ok && saved.data.value).toEqual({ starred: ['a', 'b', 'c'] });
    await laptop.pull();
    expect(laptop.get('c1')?.value).toEqual({ starred: ['a', 'b', 'c'] });
  });

  it('removes an object everywhere and restores it by saving it again', async () => {
    const server = fakeServer();
    const vaultKey = randomBytes(32);
    const laptop = await ObjectStore.open(ACCOUNT, vaultKey, server.request);
    const phone = await ObjectStore.open(ACCOUNT, vaultKey, server.request);
    await laptop.save('connection', 'c1', () => ({ label: 'OpenRouter' }));
    await phone.pull();

    expect(await laptop.remove('c1')).toEqual({ ok: true, data: null });
    await phone.pull();
    expect(phone.list('connection')).toEqual([]);

    expect((await phone.save('connection', 'c1', () => ({ label: 'OpenRouter' }))).ok).toBe(true);
    await laptop.pull();
    expect(laptop.get('c1')?.value).toEqual({ label: 'OpenRouter' });
  });

  it('counts a body it cannot open and refuses to overwrite it', async () => {
    const server = fakeServer();
    const mine = await ObjectStore.open(ACCOUNT, randomBytes(32), server.request);
    const stranger = await ObjectStore.open(ACCOUNT, randomBytes(32), server.request);
    await stranger.save('connection', 'c1', () => ({ label: 'x' }));

    await mine.pull();
    expect(mine.list('connection')).toEqual([]);
    expect(mine.unreadable()).toBe(1);
    expect(await mine.save('connection', 'c1', () => ({ label: 'y' }))).toEqual({ ok: false, error: 'unreadable' });
  });
});
