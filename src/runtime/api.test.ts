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

it('states the account the page holds with every request, and tells the page once when the server names another', async () => {
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => Response.json({ error: 'account-mismatch' }, { status: 409 }));
  vi.stubGlobal('fetch', fetch);
  const lost = vi.fn();
  holdAccount('account-a', lost);

  expect(await api('POST', 'objects/batch', {})).toEqual({ ok: false, error: 'account-mismatch' });
  await api('GET', 'objects?since=0');
  expect(fetch.mock.calls.map(([, init]) => (init.headers as Record<string, string>)['x-account'])).toEqual(['account-a', 'account-a']);
  expect(lost).toHaveBeenCalledTimes(1);
});
