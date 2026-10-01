import { lockVault } from '../vault/device';
import { cacheNewer, cacheScope, type CachedScope, type CacheWrite, type DeviceCache, type SealedChange } from './object-cache';

const caches = new Map<string, BrowserCache>();

export function deviceCache(account: string): DeviceCache {
  let cache = caches.get(account);
  if (!cache) caches.set(account, (cache = new BrowserCache(account)));
  return cache;
}

export async function forgetVault(account: string, cache = deviceCache(account)): Promise<void> {
  if (cache instanceof BrowserCache) cache.forgotten = true;
  caches.delete(account);
  await Promise.all([lockVault(), cache.clear().catch(() => {})]);
}

class BrowserCache implements DeviceCache {
  forgotten = false;
  constructor(private readonly account: string) {}

  async read(chat = ''): Promise<CachedScope | null> {
    if (this.forgotten) return null;
    const db = await database();
    const tx = db.transaction(['states', 'objects']);
    const state = request<CachedScope['state'] | undefined>(tx.objectStore('states').get([this.account, chat]));
    const changes = request<SealedChange[]>(tx.objectStore('objects').index('scope').getAll([this.account, chat]));
    const [saved, rows] = await Promise.all([state, changes]);
    return saved ? { state: saved, changes: rows } : null;
  }

  async write({ changes, feed, scopes }: CacheWrite): Promise<void> {
    const db = await database();
    if (this.forgotten) return;
    const tx = db.transaction(['states', 'objects'], 'readwrite');
    const done = completed(tx);
    const objects = tx.objectStore('objects');
    for (const row of changes) {
      const key = [this.account, row.id];
      const get = objects.get(key);
      get.onsuccess = () => {
        if (cacheNewer(get.result as SealedChange | undefined, row)) objects.put({ ...row, account: this.account, scope: cacheScope(row) }, key);
      };
    }
    tx.objectStore('states').put(feed, [this.account, '']);
    for (const scope of scopes ?? []) tx.objectStore('states').put(scope.state, [this.account, scope.chat]);
    await done;
  }

  async clear(): Promise<void> {
    const db = await database();
    const tx = db.transaction(['states', 'objects'], 'readwrite');
    const done = completed(tx);
    const range = IDBKeyRange.bound([this.account], [this.account, []]);
    tx.objectStore('states').delete(range);
    tx.objectStore('objects').delete(range);
    await done;
  }
}

let opened: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('risu-alpha-objects', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('states');
      req.result.createObjectStore('objects').createIndex('scope', ['account', 'scope']);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opened;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}
