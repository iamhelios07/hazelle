import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HttpRequest } from '../connectors/types';
import { streamKey } from '../vault/streams';
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

it('ends a read once the session is gone instead of trying again', async () => {
  const fetch = vi.fn(async () => Response.json({ error: 'no-session' }, { status: 401 }));
  vi.stubGlobal('fetch', fetch);
  expect(await stream({ id: crypto.randomUUID(), key: {} }, null, new AbortController().signal)).toEqual({ kind: 'app', code: 'no-session' });
  expect(fetch).toHaveBeenCalledOnce();
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

it('skips the pings of a call that stays silent for long, and reads the whole reply', async () => {
  const id = crypto.randomUUID();
  const mine = await streamKey();
  const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;
  const theirs = await crypto.subtle.generateKey(P256, true, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: mine.private.x, y: mine.private.y }, P256, false, []) }, theirs.privateKey, 256);
  const encode = (text: string) => new TextEncoder().encode(text);
  const hkdf = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const sealing = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encode(id), info: encode('risu-alpha stream') }, hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const frame = (type: number, seq: number, body: Uint8Array) => {
    const out = new Uint8Array(9 + body.byteLength);
    new DataView(out.buffer).setUint32(0, 5 + body.byteLength);
    out[4] = type;
    new DataView(out.buffer).setUint32(5, seq);
    out.set(body, 9);
    return out;
  };
  const sealed = async (type: number, seq: number, text: string) => {
    const iv = new Uint8Array(12);
    new DataView(iv.buffer).setUint32(8, seq);
    return frame(type, seq, new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new Uint8Array([type]) }, sealing, encode(text))));
  };
  const pings = Array.from({ length: 40 }, () => frame(4, 0, new Uint8Array()));
  const frames = [
    frame(0, 0, new Uint8Array(await crypto.subtle.exportKey('raw', theirs.publicKey))),
    ...pings,
    await sealed(1, 1, JSON.stringify({ status: 200, statusText: 'OK', headers: [['x-relay', 'upstream']] })),
    ...pings,
    await sealed(2, 2, 'Hello, '),
    ...pings,
    await sealed(2, 3, 'traveler.'),
    await sealed(3, 4, JSON.stringify({ reason: 'done', ms: 5 })),
  ];
  vi.stubGlobal('fetch', async () => new Response(new Blob(frames).stream(), { headers: { 'x-stream': 'frames' } }));
  const call = { id, key: mine.private, public: mine.public };
  const response = await stream(call, request, new AbortController().signal);
  expect(response instanceof Response && (await response.text())).toBe('Hello, traveler.');
  expect(call).toMatchObject({ took: 5 });
});
