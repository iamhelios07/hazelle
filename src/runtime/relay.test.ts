import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HttpRequest } from '../connectors/types';
import { holdAccount } from './api';
import { dropStream, relay, relayJson, stopStream, stream } from './relay';

const request: HttpRequest = { url: 'https://example.com/models', method: 'GET', headers: {}, body: null };
const broken = () => new Response(new ReadableStream({ start: (controller) => controller.error(new TypeError('network error')) }), { headers: { 'x-relay': 'upstream' } });

afterEach(() => {
  vi.unstubAllGlobals();
  holdAccount(null);
});

describe('relayJson', () => {
  it('answers a body that breaks while it is read as offline, or stopped when the signal stopped it', async () => {
    vi.stubGlobal('fetch', async () => broken());
    expect(await relayJson(request)).toEqual({ ok: false, failure: { kind: 'offline' } });

    const abort = new AbortController();
    vi.stubGlobal('fetch', async () => {
      abort.abort();
      return broken();
    });
    expect(await relayJson(request, abort.signal)).toEqual({ ok: false, failure: { kind: 'stopped' } });
  });
});

it('ends a read at once when it is stopped while it cannot reach the server', async () => {
  const abort = new AbortController();
  vi.stubGlobal('fetch', async () => {
    abort.abort();
    throw new TypeError('Failed to fetch');
  });
  const began = Date.now();
  expect(await stream({ id: crypto.randomUUID(), key: {} }, null, abort.signal)).toEqual({ kind: 'stopped' });
  expect(Date.now() - began).toBeLessThan(500);
});

it('states the account the page holds on the relay and on every stream request', async () => {
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => Response.json({ error: 'stream-exists' }, { status: 409 }));
  vi.stubGlobal('fetch', fetch);
  holdAccount('account-a');
  const id = crypto.randomUUID();
  await relay(request);
  await stream({ id, key: {}, public: 'k' }, request, new AbortController().signal);
  stopStream(id);
  dropStream(id);
  expect(fetch.mock.calls.map(([url, init]) => [url, (init.headers as Record<string, string>)['x-account']])).toEqual([
    ['/api/relay', 'account-a'],
    [`/api/streams/${id}`, 'account-a'],
    [`/api/streams/${id}/stop`, 'account-a'],
    [`/api/streams/${id}`, 'account-a'],
  ]);
});
