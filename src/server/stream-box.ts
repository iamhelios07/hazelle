import { forward, type Upstream } from './relay';

// A frame is [u32 length of what follows][u8 type][u32 seq][body]. hello's body is the object's ECDH public key in the
// clear; every other body is sealed. vault/streams opens them and runtime/relay reads them: the three change together.
const HELLO = 0;
const HEAD = 1;
const DATA = 2;
const END = 3;

// A stream that closes with no end frame was lost: its object was rebuilt with the call gone. ms: how long the call ran.
type Reason = { reason: 'done' | 'stopped' | 'limit' } | { reason: 'network'; detail: string };
export type End = Reason & { ms: number };

export type BoxStorage = {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  // Ascending, from start (inclusive) to end (exclusive), at most limit.
  list(options: { start: string; end: string; limit: number }): Promise<Map<string, unknown>>;
  deleteAll(): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

// Body bytes are gathered this long before they are sealed into one frame, so a reply is tens of stored rows, not
// thousands.
const GATHER_MS = 50;
const GATHER_BYTES = 64 * 1024;
// An outbound call keeps a Durable Object alive for up to 15 minutes from its start (tech-spec §6, Detached replies).
const LIMIT_MS = 14.5 * 60 * 1000;
// The provider's body bytes a call keeps; past them it ends as limit, as at its time. A long reply with long reasoning
// is a few MB of text, and its SSE envelope can take some ten times that.
const LIMIT_BYTES = 32 * 1024 * 1024;
// Frames a reader takes from storage at once. A frame holds GATHER_BYTES and at most one upstream chunk more.
const PAGE = 16;
// Whatever no device came back for is dropped this long after the call started.
const KEEP_MS = 24 * 60 * 60 * 1000;

const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;
// Named through crypto itself, so this module reads the same under the Worker's types and Node's (e2e/helpers).
type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
const encode = (text: string) => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
const frameKey = (seq: number) => `f:${String(seq).padStart(10, '0')}`;
// Past every frame key: ';' follows ':'.
const FRAMES_END = 'f;';

function frame(type: number, seq: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(9 + body.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, 5 + body.byteLength);
  view.setUint8(4, type);
  view.setUint32(5, seq);
  out.set(body, 9);
  return out;
}

function nonce(seq: number): Uint8Array<ArrayBuffer> {
  const iv = new Uint8Array(12);
  new DataView(iv.buffer).setUint32(8, seq);
  return iv;
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

const json = (status: number, error: string) => Response.json({ error }, { status });

// Storage holds the only copy of the frames, so memory holds what is being sealed and what each reader is sent,
// however long the answer.
export class StreamBox {
  // The seq of the next frame, and how many are stored: frames are stored in seq order, with no gap.
  private next = 0;
  private stored = 0;
  private waiting = new Set<() => void>();
  private call: AbortController | null = null;
  private running = false;
  private dropped = false;
  private writes = Promise.resolve();

  constructor(
    private readonly storage: BoxStorage,
    private readonly upstream: Upstream,
  ) {}

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (`${request.method} ${url.pathname}`) {
      case 'POST /start':
        return this.start((await request.json()) as { id: string; key: unknown; request: unknown });
      case 'GET /read':
        return this.read(Number(url.searchParams.get('from') ?? '0'));
      case 'POST /stop':
        this.call?.abort();
        return new Response(null, { status: 204 });
      case 'DELETE /':
        await this.drop();
        return new Response(null, { status: 204 });
      default:
        return json(404, 'not-found');
    }
  }

  expire() {
    return this.storage.deleteAll();
  }

  private async start({ id, key, request }: { id: string; key: unknown; request: unknown }): Promise<Response> {
    if (this.call || (await this.storage.get('started')) !== undefined) return json(409, 'stream-exists');
    const theirs = typeof key === 'string' ? fromBase64(key) : null;
    const pair = (await crypto.subtle.generateKey(P256, false, ['deriveBits'])) as { publicKey: Key; privateKey: Key };
    let sealing: Key;
    try {
      const public_ = await crypto.subtle.importKey('raw', theirs ?? new Uint8Array(), P256, false, []);
      // workers-types spells the member $public; the runtime reads public, as WebCrypto names it.
      const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: public_ } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0], pair.privateKey, 256);
      const hkdf = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
      sealing = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encode(id), info: encode('risu-alpha stream') }, hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    } catch {
      return json(400, 'bad-key');
    }
    const started = Date.now();
    await this.storage.put('started', started);
    await this.storage.setAlarm(started + KEEP_MS);
    await this.storage.put(frameKey(0), frame(HELLO, 0, new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)));
    this.next = this.stored = 1;
    this.call = new AbortController();
    this.running = true;
    void this.run(request, sealing, this.call.signal);
    return this.read(0);
  }

  private async run(envelope: unknown, sealing: Key, signal: AbortSignal) {
    let limited = false;
    const cut = () => {
      limited = true;
      this.call?.abort();
    };
    const limit = setTimeout(cut, LIMIT_MS);
    let gathered: Uint8Array[] = [];
    let size = 0;
    let gathering: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      if (gathering) clearTimeout(gathering);
      gathering = null;
      if (!size) return;
      const body = new Uint8Array(size);
      let at = 0;
      for (const chunk of gathered) {
        body.set(chunk, at);
        at += chunk.byteLength;
      }
      gathered = [];
      size = 0;
      this.append(sealing, DATA, body);
    };
    const began = Date.now();
    let received = 0;
    let end: Reason = { reason: 'done' };
    try {
      const response = await forward(this.upstream, envelope, signal);
      this.append(sealing, HEAD, encode(JSON.stringify({ status: response.status, statusText: response.statusText, headers: [...response.headers] })));
      const reader = response.body?.getReader();
      while (reader) {
        // Upstream is read no faster than its frames are stored.
        await this.writes;
        const { done, value } = await reader.read();
        if (done) break;
        gathered.push(value);
        size += value.byteLength;
        received += value.byteLength;
        if (received > LIMIT_BYTES) cut();
        if (size >= GATHER_BYTES) flush();
        else gathering ??= setTimeout(flush, GATHER_MS);
      }
    } catch (error) {
      end = limited ? { reason: 'limit' } : signal.aborted ? { reason: 'stopped' } : { reason: 'network', detail: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(limit);
    }
    flush();
    this.append(sealing, END, encode(JSON.stringify({ ...end, ms: Date.now() - began })));
    await this.writes;
    this.running = false;
    this.call = null;
    this.wake();
  }

  // Sealed in order: each frame waits for the one before it.
  private append(sealing: Key, type: number, body: Uint8Array<ArrayBuffer>) {
    const seq = this.next++;
    this.writes = this.writes.then(async () => {
      const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce(seq), additionalData: new Uint8Array([type]) }, sealing, body));
      if (this.dropped) return;
      await this.storage.put(frameKey(seq), frame(type, seq, sealed));
      this.stored = seq + 1;
      this.wake();
    });
  }

  private wake() {
    const waiting = this.waiting;
    this.waiting = new Set();
    for (const resolve of waiting) resolve();
  }

  // hello first, then every frame from seq on, then the live rest while the call runs. Frames are read from storage a
  // page at a time, as the reader takes them.
  private async read(from: number): Promise<Response> {
    const hello = (await this.storage.get(frameKey(0))) as Uint8Array | undefined;
    if (!hello) return json(404, 'stream-gone');
    let seq = Math.max(1, from);
    const body = new ReadableStream<Uint8Array>(
      {
        start: (reader) => reader.enqueue(hello),
        pull: async (reader) => {
          for (;;) {
            if (this.dropped) return reader.close();
            const stored = this.stored;
            const running = this.running;
            const page = await this.storage.list({ start: frameKey(seq), end: FRAMES_END, limit: PAGE });
            for (const bytes of page.values()) reader.enqueue(bytes as Uint8Array);
            seq += page.size;
            if (page.size) return;
            // Read before the list: a call that had ended by then had stored every frame.
            if (!running) return reader.close();
            if (this.stored === stored && this.running) await new Promise<void>((resolve) => this.waiting.add(resolve));
          }
        },
      },
      { highWaterMark: 0 },
    );
    return new Response(body, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-stream': 'frames' } });
  }

  private async drop() {
    this.dropped = true;
    this.call?.abort();
    this.wake();
    await this.storage.deleteAll();
  }
}
