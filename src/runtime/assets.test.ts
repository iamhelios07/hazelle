import { describe, expect, it } from 'vitest';
import type { ApiResult } from './api';
import { AssetUrls } from './assets';
import type { Files } from './files';
import type { ObjectStore } from './store';

const asset = { name: 'smile', type: 'image/png', size: 1, file: { id: 'a', key: 'k' } };
const store = { get: () => ({ value: asset }) } as unknown as ObjectStore;

function urlsReading(answers: ApiResult<Uint8Array<ArrayBuffer>>[]) {
  let reads = 0;
  const files = { read: () => Promise.resolve(answers[reads++]!) } as unknown as Files;
  return { urls: new AssetUrls(store, files), reads: () => reads };
}

const settled = () => new Promise((resolve) => setTimeout(resolve));

describe('AssetUrls', () => {
  it('reads a file again after it failed on the way, and never after it was not found', async () => {
    const failed = urlsReading([{ ok: false, error: 'offline' }, { ok: true, data: new Uint8Array([1]) }]);
    failed.urls.url('x');
    await settled();
    failed.urls.url('x');
    await settled();
    expect(failed.reads()).toBe(2);
    expect(failed.urls.url('x')).toMatch(/^blob:/);

    const gone = urlsReading([{ ok: false, error: 'not-found' }]);
    gone.urls.url('x');
    await settled();
    expect(gone.urls.url('x')).toBeUndefined();
    expect(gone.reads()).toBe(1);
  });
});
