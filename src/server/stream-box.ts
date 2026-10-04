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

// scripts/deploy.sh waits until no call is live. ended never rejects; the alarm sends it again for an object a deploy
// killed mid-call.
export type Live = { began(): void; ended(): Promise<void> };

// Body bytes are gathered this long before they are sealed into one frame: how soon a reader sees them.
const GATHER_MS = 50;
const GATHER_BYTES = 64 * 1024;
// Sealed frames wait in memory until they are written as one page, so a reply is one row per PERSIST_MS, not one per
// frame: each put is a billed row, and so is its delete. A page stays under the 2 MB a value may hold.
const PERSIST_MS = 2000;
const PAGE_BYTES = 256 * 1024;
// An outbound call keeps a Durable Object alive for up to 15 minutes from its start (tech-spec §6, Detached replies).
const LIMIT_MS = 14.5 * 60 * 1000;
// The provider's body bytes a call keeps; past them it ends as limit, as at its time. A long reply with long reasoning
// is a few MB of text, and its SSE envelope can take some ten times that.
const LIMIT_BYTES = 32 * 1024 * 1024;
// Pages a reader takes from storage at once. A page holds PAGE_BYTES and at most one frame more.
const PAGE = 4;
// Whatever no device came back for is dropped this long after the call started.
const KEEP_MS = 24 * 60 * 60 * 1000;

const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;
// Named through crypto itself, so this module reads the same under the Worker's types and Node's (e2e/helpers).
type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
const encode = (text: string) => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
// A page is keyed by the seq of its last frame, so a reader listing from a seq gets the page holding it; the reader
// drops the frames before its seq. hello is a page of its own at f:0.
const frameKey = (seq: number) => `f:${String(seq).padStart(10, '0')}`;
const seqOf = (key: string) => Number(key.slice(2));
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

// Memory holds the frames not yet written (from persisted on, in seq order, no gap) and what each reader is sent;
// storage holds every page before them, however long the answer.
export class StreamBox {
  private next = 0;
  private persisted = 0;
  private pending: { seq: number; bytes: Uint8Array }[] = [];
  private pendingBytes = 0;
  private persisting: ReturnType<typeof setTimeout> | null = null;
  private waiting = new Set<() => void>();
  private call: AbortController | null = null;
  private running = false;
  private dropped = false;
  private writes = Promise.resolve();

  constructor(
    private readonly storage: BoxStorage,
    private readonly upstream: Upstream,
    private readonly live: Live,
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

  async expire() {
    await Promise.all([this.storage.deleteAll(), this.live.ended()]);
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
    this.next = this.persisted = 1;
    this.call = new AbortController();
    this.running = true;
    this.live.began();
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
        // Upstream is read no faster than its frames are sealed and its full pages stored.
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
    // A call that has ended has stored every frame.
    await this.persist();
    this.running = false;
    this.call = null;
    this.wake();
    await this.live.ended();
  }

  // Sealed in order: each frame waits for the one before it. A frame that would take the page past its bytes is
  // written after the page, as one of its own at most.
  private append(sealing: Key, type: number, body: Uint8Array<ArrayBuffer>) {
    const seq = this.next++;
    this.writes = this.writes.then(async () => {
      const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce(seq), additionalData: new Uint8Array([type]) }, sealing, body));
      if (this.dropped) return;
      const bytes = frame(type, seq, sealed);
      if (this.pendingBytes && this.pendingBytes + bytes.byteLength > PAGE_BYTES) await this.writePage();
      this.pending.push({ seq, bytes });
      this.pendingBytes += bytes.byteLength;
      this.persisting ??= setTimeout(() => void this.persist(), PERSIST_MS);
      this.wake();
    });
  }

  // Pending frames are kept until their page is written, so a reader finds every frame in memory or in storage.
  private persist(): Promise<void> {
    this.writes = this.writes.then(() => this.writePage());
    return this.writes;
  }

  private async writePage() {
    if (this.persisting) clearTimeout(this.persisting);
    this.persisting = null;
    if (this.dropped || !this.pending.length) return;
    const page = this.pending;
    const bytes = new Uint8Array(this.pendingBytes);
    let at = 0;
    for (const { bytes: frame } of page) {
      bytes.set(frame, at);
      at += frame.byteLength;
    }
    const last = page[page.length - 1]!.seq;
    await this.storage.put(frameKey(last), bytes);
    this.persisted = last + 1;
    this.pending = this.pending.slice(page.length);
    this.pendingBytes -= bytes.byteLength;
    if (this.pending.length) this.persisting ??= setTimeout(() => void this.persist(), PERSIST_MS);
    this.wake();
  }

  private wake() {
    const waiting = this.waiting;
    this.waiting = new Set();
    for (const resolve of waiting) resolve();
  }

  // hello first, then every frame from seq on, then the live rest while the call runs: stored pages while seq is behind
  // what is persisted (always, once the call is over or the object was rebuilt), then the frames still in memory.
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
            // Read before the list: a call that had ended by then had stored every frame.
            const running = this.running;
            if (seq < this.persisted || !running) {
              const pages = await this.storage.list({ start: frameKey(seq), end: FRAMES_END, limit: PAGE });
              for (const [key, bytes] of pages) {
                reader.enqueue(bytes as Uint8Array);
                seq = seqOf(key) + 1;
              }
              if (pages.size) return;
              if (!running) return reader.close();
            }
            const held = this.pending.length - (seq - this.persisted);
            if (held > 0) {
              for (const { bytes } of this.pending.slice(-held)) reader.enqueue(bytes);
              seq += held;
              return;
            }
            if (this.running) await new Promise<void>((resolve) => this.waiting.add(resolve));
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
    // A call the object lost to a deploy has no run left to end it.
    await Promise.all([this.storage.deleteAll(), this.live.ended()]);
  }
}
