import { expect, it } from 'vitest';
import { DATA, END, HEAD, HELLO } from '../contracts/streams';
import { relayBudget } from './limits';
import { replyKey, testApp } from './testing';

const encode = (text: string) => new TextEncoder().encode(text);
const request = { url: 'https://custom.example/v1/chat', method: 'POST', headers: {}, body: '{}' };
async function call() {
  return { ...(await replyKey()), id: crypto.randomUUID() };
}
async function opened(response: Response, id: string, pair: CryptoKeyPair) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const frames: { type: number; body: Uint8Array }[] = [];
  let key: CryptoKey | undefined;
  for (let at = 0; at < bytes.length;) {
    const view = new DataView(bytes.buffer, at);
    const type = view.getUint8(4);
    const seq = view.getUint32(5);
    const body = bytes.slice(at + 9, at + 4 + view.getUint32(0));
    at += 4 + view.getUint32(0);
    if (type === HELLO) {
      const publicKey = await crypto.subtle.importKey('raw', body, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, pair.privateKey, 256);
      const hkdf = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
      key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encode(id), info: encode('risu-alpha stream') }, hkdf, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    } else {
      const iv = new Uint8Array(12);
      new DataView(iv.buffer).setUint32(8, seq);
      frames.push({ type, body: new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: new Uint8Array([type]) }, key!, body)) });
    }
  }
  return frames;
}
const json = (body: Uint8Array) => JSON.parse(new TextDecoder().decode(body)) as unknown;

it('charges detached response bytes after the reader leaves, aborts upstream, and seals a limit ending', async () => {
  let signal: AbortSignal | undefined;
  let now = 0;
  const t = await testApp(async (_url, init) => {
    signal = init.signal;
    return new Response(new ReadableStream<Uint8Array>({
      pull: (controller) => controller.enqueue(new Uint8Array(512)),
    }, { highWaterMark: 0 }), { headers: { 'content-type': 'text/event-stream' } });
  }, relayBudget(2048, 30, () => now));
  try {
    const { cookie } = await t.signUp();
    const { pair, id, key } = await call();
    const started = await t.post(`streams/${id}`, { key, request }, cookie);
    await started.body!.cancel();
    await t.env.streams.settled();
    expect(signal?.aborted).toBe(true);
    const next = await t.post('relay', request, cookie);
    expect([next.status, await next.json()]).toEqual([429, { error: 'relay-traffic-limit' }]);
    now = 86_400_000;
    const frames = await opened(await t.get(`streams/${id}`, cookie), id, pair);
    expect(frames.filter(({ type }) => type === DATA).reduce((sum, { body }) => sum + body.byteLength, 0)).toBe(1536);
    expect(json(frames.find(({ type }) => type === END)!.body)).toMatchObject({ reason: 'limit' });
    const replay = await t.get(`streams/${id}`, cookie);
    expect((await replay.arrayBuffer()).byteLength).toBeLessThanOrEqual(74);
  } finally {
    t.dispose();
  }
});

it('shares the authenticated budget between direct calls and detached retries, without retrying a quota refusal', async () => {
  let calls = 0;
  let now = 0;
  const t = await testApp(async () => ++calls === 1 ? new Response(null, { status: 204 }) : new Response(null, { status: 429, headers: { 'retry-after': '0' } }), relayBudget(2000, 30, () => now));
  try {
    const { cookie } = await t.signUp();
    expect((await t.post('relay', { ...request, body: '한' }, cookie)).status).toBe(204);
    const { pair, id, key } = await call();
    const started = await t.post(`streams/${id}`, { key, request: { ...request, body: 'x'.repeat(1024) }, bot: crypto.randomUUID(), retry: { times: 5, statuses: [429] } }, cookie);
    await started.body!.cancel();
    await t.env.streams.settled();
    now = 86_400_000;
    const frames = await opened(await t.get(`streams/${id}`, cookie), id, pair);
    expect(calls).toBe(2);
    expect(json(frames.find(({ type }) => type === HEAD)!.body)).toMatchObject({ status: 429, tries: 2 });
    expect(json(frames.find(({ type }) => type === DATA)!.body)).toEqual({ error: 'relay-traffic-limit' });
  } finally {
    t.dispose();
  }
});
