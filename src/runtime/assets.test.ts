import { describe, expect, it, vi } from 'vitest';
import type { ApiResult } from './api';
import { AssetUrls } from './assets';
import type { Files } from './files';
import type { ObjectStore } from './store';

const asset = { name: 'smile', type: 'image/png', size: 1, file: { id: 'a', key: 'k' } };
const store = { get: () => ({ value: asset }), subscribe: () => () => {} } as unknown as ObjectStore;

function urlsReading(answers: ApiResult<Uint8Array<ArrayBuffer>>[]) {
  let reads = 0;
  const files = { read: () => Promise.resolve(answers[reads++]!) } as unknown as Files;
  const urls = new AssetUrls(store, files);
  return { urls, url: urls.view().url, reads: () => reads };
}

const settled = () => new Promise((resolve) => setTimeout(resolve));

describe('AssetUrls', () => {
  it('reads a file again after it failed on the way, and never after it was not found', async () => {
    const failed = urlsReading([{ ok: false, error: 'offline' }, { ok: true, data: new Uint8Array([1]) }]);
    failed.url('x');
    await settled();
    failed.url('x');
    await settled();
    expect(failed.reads()).toBe(2);
    expect(failed.url('x')).toMatch(/^blob:/);

    const gone = urlsReading([{ ok: false, error: 'not-found' }]);
    gone.url('x');
    await settled();
    expect(gone.url('x')).toBeUndefined();
    expect(gone.reads()).toBe(1);
  });
});

it('evicts only inactive bytes, shares active pins, and reloads an evicted picture', async () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  const read = vi.fn(async () => ({ ok: true as const, data: new Uint8Array(2) }));
  const store = { get: (_kind: string, id: string) => ({ value: { ...asset, file: { id, key: 'k' } } }), subscribe: () => () => {} } as unknown as ObjectStore;
  const urls = new AssetUrls(store, { read }, 2);
  const first = urls.view();
  const second = urls.view();
  const releaseFirst = first.hold();
  const releaseSecond = second.hold();
  first.url('a');
  second.url('a');
  second.url('b');
  await settled();
  const a = first.url('a')!;
  const b = second.url('b')!;
  expect(read).toHaveBeenCalledTimes(2);
  releaseFirst();
  expect(revoke).not.toHaveBeenCalled();
  releaseSecond();
  expect(revoke).toHaveBeenCalledExactlyOnceWith(a);
  const idle = urls.view();
  expect(idle.url('b')).toBe(b);
  expect(idle.url('a')).toBeUndefined();
  await settled();
  expect(read).toHaveBeenCalledTimes(3);
  expect(revoke).toHaveBeenCalledWith(b);
  urls.close();
  revoke.mockRestore();
});

it('defers removal revocation while mounted and supports strict-effect reactivation', async () => {
  let current: typeof asset | undefined = asset;
  let change!: Parameters<ObjectStore['subscribe']>[0];
  const store = {
    get: () => current && { value: current },
    subscribe: (listener: typeof change) => { change = listener; return () => {}; },
  } as unknown as ObjectStore;
  const read = vi.fn(async () => ({ ok: true as const, data: new Uint8Array(2) }));
  const urls = new AssetUrls(store, { read }, 2);
  const view = urls.view();
  view.url('x');
  view.hold()();
  const release = view.hold();
  await settled();
  const url = view.url('x')!;
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  current = undefined;
  change([{ kind: 'asset', id: 'x', parent: 'character' }]);
  expect(view.url('x')).toBeUndefined();
  expect(revoke).not.toHaveBeenCalled();
  release();
  expect(revoke).toHaveBeenCalledExactlyOnceWith(url);
  urls.close();
  revoke.mockRestore();
});
