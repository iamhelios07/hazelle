import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
});
afterEach(() => vi.unstubAllGlobals());

const done = (request: IDBRequest | IDBTransaction) => new Promise((resolve, reject) => {
  if (request instanceof IDBTransaction) request.oncomplete = resolve;
  else request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

it('keeps a version-2 cache’s rows when it adds the guest stores', async () => {
  const { database } = await import('./device-cache');
  const old = indexedDB.open('risu-alpha-objects', 2);
  old.onupgradeneeded = () => {
    old.result.createObjectStore('generations');
    old.result.createObjectStore('states');
    old.result.createObjectStore('objects').createIndex('scope', ['account', 'scope']);
  };
  const v2 = (await done(old)) as IDBDatabase;
  const tx = v2.transaction('objects', 'readwrite');
  tx.objectStore('objects').put({ id: 'kept', scope: '' }, ['account', 'kept']);
  await done(tx);
  v2.close();
  const db = await database();
  expect([...db.objectStoreNames].sort()).toEqual(['generations', 'guest-files', 'guest-heads', 'guest-objects', 'objects', 'states']);
  expect(await done(db.transaction('objects').objectStore('objects').get(['account', 'kept']))).toEqual({ id: 'kept', scope: '' });
});

it('retries a blocked cache upgrade without keeping its rejected promise or late connection', async () => {
  const old = indexedDB.open('risu-alpha-objects', 2);
  old.onupgradeneeded = () => {
    old.result.createObjectStore('generations');
    old.result.createObjectStore('states');
    old.result.createObjectStore('objects').createIndex('scope', ['account', 'scope']);
  };
  const v2 = (await done(old)) as IDBDatabase;
  const { database } = await import('./device-cache');
  const { DatabaseBlocked } = await import('../vault/database');
  try {
    await expect(database()).rejects.toBeInstanceOf(DatabaseBlocked);
  } finally {
    v2.close();
  }
  const db = await database();
  expect(db.version).toBe(3);
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('risu-alpha-objects');
    req.onsuccess = () => resolve();
    req.onblocked = () => reject(new Error('A late or current connection stayed open'));
    req.onerror = () => reject(req.error);
  });
  expect((await database()).version).toBe(3);
});
