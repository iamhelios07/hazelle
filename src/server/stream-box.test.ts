import { expect, it } from 'vitest';
import type { Upstream } from './relay';
import { StreamBox, type BoxStorage } from './stream-box';

const CHUNK = 64 * 1024;
const uncounted = { began: () => {}, ended: async () => {} };

function memory(): BoxStorage {
  const held = new Map<string, unknown>();
  return {
    get: async (key) => held.get(key),
    put: async (key, value) => void held.set(key, value),
    list: async ({ start, end, limit }) => new Map([...held].filter(([key]) => key >= start && key < end).sort(([a], [b]) => (a < b ? -1 : 1)).slice(0, limit)),
    deleteAll: async () => held.clear(),
    setAlarm: async () => {},
  };
}

// A provider that answers as fast as it is read, until the call is aborted, as a fetch's body errors then. It ends
// at twice the box's bound, so a box with no bound holds 64 MB at most. pulled: how many chunks it gave.
function endless() {
  const counted = { pulled: 0 };
  const upstream: Upstream = async (_url, { signal }) =>
    new Response(
      new ReadableStream<Uint8Array>(
        {
          pull: (controller) => {
            if (signal.aborted) return controller.error(signal.reason);
            if (counted.pulled === 1024) return controller.close();
            counted.pulled++;
            controller.enqueue(new Uint8Array(CHUNK));
          },
        },
        { highWaterMark: 0 },
      ),
    );
  return { counted, upstream };
}

async function start(box: StreamBox) {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const key = btoa(String.fromCharCode(...new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)));
  const request = { url: 'https://api.example.com/v1/chat', method: 'POST', headers: {}, body: '{}' };
  return box.handle(new Request('https://stream/start', { method: 'POST', body: JSON.stringify({ id: crypto.randomUUID(), key, request }) }));
}

it('reads the provider no faster than its frames are stored', async () => {
  const storage = memory();
  let open = () => {};
  const gate = new Promise<void>((resolve) => (open = resolve));
  const put = storage.put;
  storage.put = async (key, value) => {
    if (key !== 'f:0000000000' && key !== 'started') await gate;
    return put(key, value);
  };
  const { counted, upstream } = endless();
  const box = new StreamBox(storage, upstream, uncounted);
  await start(box);
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(counted.pulled).toBeLessThan(4);
  await box.handle(new Request('https://stream/', { method: 'DELETE' }));
  open();
});

it('ends a call whose answer passes the byte bound, with what came before it sent', async () => {
  const { upstream } = endless();
  const response = await start(new StreamBox(memory(), upstream, uncounted));
  const reader = response.body!.getReader();
  let buffer = new Uint8Array(0);
  let last = -1;
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    const joined = new Uint8Array(buffer.byteLength + value.byteLength);
    joined.set(buffer);
    joined.set(value, buffer.byteLength);
    buffer = joined;
    while (buffer.byteLength >= 9 && buffer.byteLength >= 4 + new DataView(buffer.buffer, buffer.byteOffset).getUint32(0)) {
      last = buffer[4]!;
      buffer = buffer.slice(4 + new DataView(buffer.buffer, buffer.byteOffset).getUint32(0));
    }
  }
  expect(last).toBe(3);
  expect(bytes / 2 ** 20).toBeGreaterThan(32);
  expect(bytes / 2 ** 20).toBeLessThan(33);
});
