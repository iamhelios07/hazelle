import { afterEach, expect, it, vi } from 'vitest';
import { api, holdAccount } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  holdAccount(null);
});

it('reads a connection that drops inside the answer as offline, and a whole answer that is not JSON as a server error', async () => {
  const dropped = new ReadableStream<Uint8Array>({
    pull: (controller) => {
      controller.enqueue(new TextEncoder().encode('{"revs":'));
      controller.error(new TypeError('network error'));
    },
  });
  vi.stubGlobal('fetch', async () => new Response(dropped));
  expect(await api('POST', 'objects/batch', {})).toEqual({ ok: false, error: 'offline' });

  vi.stubGlobal('fetch', async () => new Response('<html>502</html>', { status: 502 }));
  expect(await api('POST', 'objects/batch', {})).toEqual({ ok: false, error: 'server-error' });
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
