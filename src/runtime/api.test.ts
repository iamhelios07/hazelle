import { afterEach, expect, it, vi } from 'vitest';
import { api } from './api';

afterEach(() => vi.unstubAllGlobals());

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
