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

// DurableObjectStorage, or the harness's map.
export type BoxStorage = {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  list(options: { prefix: string }): Promise<Map<string, unknown>>;
  deleteAll(): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

// Body bytes are gathered this long before they are sealed into one frame, so a reply is tens of stored rows, not
// thousands.
const GATHER_MS = 50;
const GATHER_BYTES = 64 * 1024;
// An outbound call keeps a Durable Object alive for up to 15 minutes from its start (tech-spec §6, Detached replies).
const LIMIT_MS = 14.5 * 60 * 1000;
// Whatever no device came back for is dropped this long after the call started.
const KEEP_MS = 24 * 60 * 60 * 1000;

const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;
// Named through crypto itself, so this module reads the same under the Worker's types and Node's (e2e/helpers).
type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
const encode = (text: string) => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
const frameKey = (seq: number) => `f:${String(seq).padStart(10, '0')}`;

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

// One generation call, kept apart from the client that asked for it: it reads the upstream answer to the end and
// seals it into frames that any reader gets from the start, then live.
export class StreamBox {
  // Every frame since this instance made the call, hello first; empty in an instance rebuilt after it.
  private frames: Uint8Array[] = [];
  private readonly readers = new Set<ReadableStreamDefaultController<Uint8Array>>();
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
    const hello = frame(HELLO, 0, new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer));
    this.frames.push(hello);
    await this.storage.put(frameKey(0), hello);
    this.call = new AbortController();
    this.running = true;
    void this.run(request, sealing, this.call.signal);
    return this.read(0);
  }

  private async run(envelope: unknown, sealing: Key, signal: AbortSignal) {
    let limited = false;
    const limit = setTimeout(() => {
      limited = true;
      this.call?.abort();
    }, LIMIT_MS);
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
    let end: Reason = { reason: 'done' };
    try {
      const response = await forward(this.upstream, envelope, signal);
      this.append(sealing, HEAD, encode(JSON.stringify({ status: response.status, statusText: response.statusText, headers: [...response.headers] })));
      const reader = response.body?.getReader();
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        gathered.push(value);
        size += value.byteLength;
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
    for (const reader of this.readers) reader.close();
    this.readers.clear();
  }

  // Sealed in order: each frame waits for the one before it.
  private append(sealing: Key, type: number, body: Uint8Array<ArrayBuffer>) {
    const seq = this.frames.length;
    this.frames.push(new Uint8Array());
    this.writes = this.writes.then(async () => {
      const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce(seq), additionalData: new Uint8Array([type]) }, sealing, body));
      if (this.dropped) return;
      const bytes = frame(type, seq, sealed);
      this.frames[seq] = bytes;
      for (const reader of this.readers) reader.enqueue(bytes);
      await this.storage.put(frameKey(seq), bytes);
    });
  }

  // hello first, then every frame from seq on, then the live rest while the call runs.
  private async read(from: number): Promise<Response> {
    let frames = this.frames;
    if (!frames.length) {
      const stored = await this.storage.list({ prefix: 'f:' });
      frames = [...stored.keys()].sort().map((key) => stored.get(key) as Uint8Array);
    }
    if (!frames.length) return json(404, 'stream-gone');
    // A frame still being sealed is sent live when it is.
    const ready = frames.findIndex((bytes) => !bytes.byteLength);
    const sent = ready === -1 ? frames : frames.slice(0, ready);
    let held: ReadableStreamDefaultController<Uint8Array> | null = null;
    const body = new ReadableStream<Uint8Array>({
      start: (reader) => {
        reader.enqueue(sent[0]!);
        for (const bytes of sent.slice(Math.max(1, from))) reader.enqueue(bytes);
        if (this.running) {
          held = reader;
          this.readers.add(reader);
        } else reader.close();
      },
      cancel: () => {
        if (held) this.readers.delete(held);
      },
    });
    return new Response(body, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-stream': 'frames' } });
  }

  private async drop() {
    this.dropped = true;
    this.call?.abort();
    for (const reader of this.readers) reader.close();
    this.readers.clear();
    this.frames = [];
    await this.storage.deleteAll();
  }
}

