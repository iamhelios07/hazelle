import { afterEach, expect, it, vi } from 'vitest';
import { api, hearServedVersion, holdAccount, SLOW_ROUTE_WAIT } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  holdAccount(null);
});

it('reads a connection that drops inside the answer or a 5xx page the proxy wrote as offline, and another answer that is not JSON as a server error with its status', async () => {
  const dropped = new ReadableStream<Uint8Array>({
    pull: (controller) => {
      controller.enqueue(new TextEncoder().encode('{"revs":'));
      controller.error(new TypeError('network error'));
    },
  });
  vi.stubGlobal('fetch', async () => new Response(dropped));
  expect(await api('POST', 'objects/batch', {})).toEqual({ ok: false, error: 'offline' });

  vi.stubGlobal('fetch', async () => new Response('<html>502</html>', { status: 502 }));
  expect(await api('POST', 'objects/batch', {})).toEqual({ ok: false, error: 'offline' });

  vi.stubGlobal('fetch', async () => new Response('<html>403</html>', { status: 403 }));
  expect(await api('POST', 'objects/batch', {})).toEqual({ ok: false, error: 'server-error', status: 403 });
});

it('states the account the page holds with every request, and hears what answers say of the account', async () => {
  const answers = [
    Response.json({ error: 'suspended' }, { status: 403, headers: { 'x-relay': 'upstream' } }),
    Response.json({ error: 'suspended' }, { status: 403 }),
    Response.json({ error: 'storage-full' }, { status: 413 }),
    Response.json({ revs: [1] }, { headers: { 'x-account-bytes': '120' } }),
    new Response(null, { status: 204, headers: { 'x-account-file-bytes': '30' } }),
    Response.json({ error: 'account-mismatch' }, { status: 409 }),
    Response.json({ error: 'account-mismatch' }, { status: 409 }),
  ];
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => answers.shift()!);
  vi.stubGlobal('fetch', fetch);
  const heard = vi.fn();
  holdAccount('account-a', heard);

  for (let sent = 0; sent < 7; sent++) await api('POST', 'objects/batch', {});
  expect(fetch.mock.calls.map(([, init]) => (init.headers as Record<string, string>)['x-account'])).toEqual(Array(7).fill('account-a'));
  expect(heard.mock.calls.map(([told]) => told)).toEqual([
    { kind: 'suspended' },
    { kind: 'storage-full' },
    { kind: 'bytes', bytes: 120 },
    { kind: 'file-bytes', fileBytes: 30 },
    { kind: 'elsewhere' },
  ]);
});

it('tells each release the server says it runs once, and a listener that comes later the last one said', async () => {
  const answers = ['v1', 'v1', null, 'v2'].map((version) => Response.json({}, { headers: version ? { 'x-hazelle-version': version } : {} }));
  vi.stubGlobal('fetch', async () => answers.shift()!);
  const heard = vi.fn();
  hearServedVersion(heard);
  for (let sent = 0; sent < 4; sent++) await api('GET', 'session');
  expect(heard.mock.calls).toEqual([['v1'], ['v2']]);

  const later = vi.fn();
  hearServedVersion(later);
  expect(later.mock.calls).toEqual([['v2']]);
  hearServedVersion(null);
});

it('gives up on headers that never come as offline, so the store waits for the connection instead', async () => {
  vi.useFakeTimers();
  try {
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    const answer = api('POST', 'objects/batch', {});
    const slow = api('DELETE', 'account', {}, undefined, SLOW_ROUTE_WAIT);
    let slowEnded = false;
    void slow.then(() => (slowEnded = true));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await answer).toEqual({ ok: false, error: 'offline' });
    expect(slowEnded).toBe(false);
    await vi.advanceTimersByTimeAsync(SLOW_ROUTE_WAIT);
    expect(await slow).toEqual({ ok: false, error: 'offline' });
  } finally {
    vi.useRealTimers();
  }
});
