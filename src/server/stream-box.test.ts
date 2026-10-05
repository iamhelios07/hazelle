import { expect, it } from 'vitest';
import type { Upstream } from './relay';
import { StreamBox } from './stream-box';
import { streamStore } from './db/streams-db';

const CHUNK = 64 * 1024;
// A request whose client never leaves.
const staying = new AbortController().signal;
const PAGE_BYTES = 256 * 1024;
const storage = () => streamStore(':memory:').storage('s');

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
  return box.start({ id: crypto.randomUUID(), key, request }, staying);
}

// A page's frames and the one that closed it are read before the first put has to answer.
it('reads the provider no faster than its pages are stored', async () => {
  const held = storage();
  let open = () => {};
  const gate = new Promise<void>((resolve) => (open = resolve));
  const put = held.put;
  held.put = async (key, value) => {
    await gate;
    return put(key, value);
  };
  const { counted, upstream } = endless();
  const box = new StreamBox(held, upstream, () => {});
  await start(box);
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(counted.pulled).toBeLessThanOrEqual(PAGE_BYTES / CHUNK + 1);
  open();
  await box.drop();
});

// Every frame's [type, seq] in the order the body carries them, and how many bytes it carried.
async function frames(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const seen: [number, number][] = [];
  let buffer = new Uint8Array(0);
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
      seen.push([buffer[4]!, new DataView(buffer.buffer, buffer.byteOffset).getUint32(5)]);
      buffer = buffer.slice(4 + new DataView(buffer.buffer, buffer.byteOffset).getUint32(0));
    }
  }
  return { seen, bytes };
}

it('ends a call whose answer passes the byte bound, with what came before it sent', async () => {
  const { upstream } = endless();
  const response = await start(new StreamBox(storage(), upstream, () => {}));
  const { seen, bytes } = await frames(response.body!);
  expect(seen.at(-1)![0]).toBe(3);
  expect(bytes / 2 ** 20).toBeGreaterThan(32);
  expect(bytes / 2 ** 20).toBeLessThan(33);
});

it('stores a short reply as one page, which a read from inside it still ends', async () => {
  const held = storage();
  const upstream: Upstream = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          for (let i = 0; i < 10; i++) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            controller.enqueue(new Uint8Array(100));
          }
          controller.close();
        },
      }),
    );
  const box = new StreamBox(held, upstream, () => {});
  const live = await frames((await start(box)).body!);
  expect(live.seen.length).toBeGreaterThan(4);
  expect(live.seen.at(-1)![0]).toBe(3);
  const pages = await held.list({ start: 'f:', end: 'f;', limit: 10 });
  expect([...pages.keys()]).toEqual(['f:0000000000', `f:${String(live.seen.length - 1).padStart(10, '0')}`]);
  const again = await frames((await box.read(3, staying)).body!);
  expect(again.seen[0]).toEqual([0, 0]);
  expect(again.seen.at(-1)).toEqual(live.seen.at(-1));
});

// Only the first write fails, so a write tried after it would be stored and seen.
it('ends its readers with an error, aborts the call and tries no write, END included, once a page write fails', async () => {
  const held = storage();
  const put = held.put;
  let puts = 0;
  held.put = async (key, value) => {
    if (++puts === 1) throw new Error('disk full');
    return put(key, value);
  };
  let aborted = false;
  const upstream: Upstream = async (_url, { signal }) => {
    signal.addEventListener('abort', () => (aborted = true));
    return new Response(new ReadableStream({ pull: (body) => (signal.aborted ? body.error(signal.reason) : body.enqueue(new Uint8Array(CHUNK))) }, { highWaterMark: 0 }));
  };
  const box = new StreamBox(held, upstream, () => {});
  const reading = frames((await start(box)).body!);
  await expect(reading).rejects.toThrow('stream write failed');
  await box.ended;
  expect(aborted).toBe(true);
  expect(box.running).toBe(false);
  expect(puts).toBe(1);
  expect([...(await held.list({ start: 'f:', end: 'f;', limit: 10 })).keys()]).toEqual(['f:0000000000']);
});

// As a server does with a request whose client left: the body is never read or cancelled.
it.each([true, false])('stops counting a reader whose client left (before its response was built: %s)', async (before) => {
  const held = storage();
  await held.reserve({ key: 'f:0000000000', value: new Uint8Array(9) }, Date.now() + 60_000);
  let idle = 0;
  const box = new StreamBox(held, endless().upstream, () => idle++);
  const request = new AbortController();
  if (before) request.abort();
  expect((await box.read(0, request.signal)).status).toBe(200);
  request.abort();
  expect(idle).toBe(1);
});
