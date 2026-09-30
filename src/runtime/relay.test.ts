import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HttpRequest } from '../connectors/types';
import { relayJson } from './relay';

const request: HttpRequest = { url: 'https://example.com/models', method: 'GET', headers: {}, body: null };
const broken = () => new Response(new ReadableStream({ start: (controller) => controller.error(new TypeError('network error')) }), { headers: { 'x-relay': 'upstream' } });

afterEach(() => vi.unstubAllGlobals());

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
