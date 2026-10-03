import { afterEach, expect, it, vi } from 'vitest';
import { deviceCache } from './device-cache';

afterEach(() => vi.unstubAllGlobals());

it('creates the current cache together and reuses the first account generation on reopen', async () => {
  const stores = new Map<string, Map<string, unknown>>();
  const index = vi.fn();
  const db = {
    createObjectStore: (name: string) => {
      if (stores.has(name)) throw new Error('duplicate store');
      stores.set(name, new Map());
      return { createIndex: index };
    },
    transaction: () => {
      const tx = {
        objectStore: (name: string) => {
          const values = stores.get(name)!;
          return {
            get: (key: unknown) => {
              const request = { result: values.get(JSON.stringify(key)), onsuccess: null as (() => void) | null };
              queueMicrotask(() => request.onsuccess?.());
              return request;
            },
            put: (value: unknown, key: unknown) => values.set(JSON.stringify(key), value),
            delete: () => values.clear(),
          };
        },
        oncomplete: null as (() => void) | null,
      };
      setTimeout(() => tx.oncomplete?.(), 0);
      return tx;
    },
  };
  const open = vi.fn(() => {
    const request = { result: db, onupgradeneeded: null as (() => void) | null, onsuccess: null as (() => void) | null };
    queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.(); });
    return request;
  });
  vi.stubGlobal('indexedDB', { open });
  vi.stubGlobal('IDBKeyRange', { bound: vi.fn() });
  const cache = deviceCache('fresh-cache-account');
  const first = await cache.open();
  expect(first).toEqual({ generation: { id: expect.any(String), timeline: null }, saved: null });
  expect(await cache.open()).toEqual(first);
  expect([...stores.keys()]).toEqual(['generations', 'states', 'objects']);
  expect(index).toHaveBeenCalledExactlyOnceWith('scope', ['account', 'scope']);
  expect(open).toHaveBeenCalledExactlyOnceWith('risu-alpha-objects', 2);
});
