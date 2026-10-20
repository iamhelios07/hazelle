import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { database } from './device-cache';

const done = (request: IDBRequest | IDBTransaction) => new Promise((resolve, reject) => {
  if (request instanceof IDBTransaction) request.oncomplete = resolve;
  else request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

it('keeps a version-2 cache’s rows when it adds the guest stores', async () => {
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
