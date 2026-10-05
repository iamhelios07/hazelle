import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Upstream } from './relay';
import { streamRegistry } from './stream-registry';

// A provider that answers only when the call is aborted.
const hanging: Upstream = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));

async function start(box: { handle(request: Request): Promise<Response> }) {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const key = btoa(String.fromCharCode(...new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)));
  const request = { url: 'https://api.example.com/v1/chat', method: 'POST', headers: {}, body: '{}' };
  const response = await box.handle(new Request('https://stream/start', { method: 'POST', body: JSON.stringify({ id: crypto.randomUUID(), key, request }) }));
  expect(response.status).toBe(200);
  void response.body?.cancel();
}

afterEach(() => vi.useRealTimers());

describe('the stream registry', () => {
  it('keeps one box per name', () => {
    const streams = streamRegistry(hanging);
    expect(streams.box('a')).toBe(streams.box('a'));
    expect(streams.box('a')).not.toBe(streams.box('b'));
  });

  it('counts a call live from its start to its end, and a second end of the same box counts nothing', async () => {
    const streams = streamRegistry(hanging);
    await start(streams.box('a'));
    await start(streams.box('b'));
    expect(streams.live()).toBe(2);
    await streams.box('a').handle(new Request('https://stream/stop', { method: 'POST' }));
    await vi.waitFor(() => expect(streams.live()).toBe(1));
    await streams.box('a').handle(new Request('https://stream/', { method: 'DELETE' }));
    expect(streams.live()).toBe(1);
    await streams.box('b').handle(new Request('https://stream/', { method: 'DELETE' }));
    expect(streams.live()).toBe(0);
  });

  it('expires a box at its alarm and forgets it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const streams = streamRegistry(hanging);
    const box = streams.box('a');
    await start(box);
    expect(streams.live()).toBe(1);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(streams.live()).toBe(0);
    expect(streams.box('a')).not.toBe(box);
  });
});
