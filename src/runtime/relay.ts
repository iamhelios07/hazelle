import { providerMessage } from '../connectors/errors';
import { isRecord } from '../connectors/values';
import type { HttpRequest } from '../connectors/types';
import { streamOpener } from '../vault/streams';

// Whose refusal it was decides what the user is told: the provider's answer, the relay's
// own refusal (X-Relay: error), the app's (no X-Relay header, such as an expired session), or no
// connection at all.
export type RelayFailure =
  | { kind: 'provider'; status: number; detail: string }
  | { kind: 'relay'; code: string }
  | { kind: 'app'; code: string }
  | { kind: 'offline' }
  | { kind: 'stopped' };

export type JsonAnswer = { ok: true; data: unknown } | { ok: false; failure: RelayFailure };

const lost = (signal?: AbortSignal): RelayFailure => (signal?.aborted ? { kind: 'stopped' } : { kind: 'offline' });

// The provider's answer, whatever its status.
async function send(request: HttpRequest, signal?: AbortSignal): Promise<Response | RelayFailure> {
  let response: Response;
  try {
    response = await fetch('/api/relay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
  } catch {
    return lost(signal);
  }
  return sourced(response);
}

async function sourced(response: Response): Promise<Response | RelayFailure> {
  const source = response.headers.get('x-relay');
  if (source === 'upstream') return response;
  const code = await errorCode(response);
  return source === 'error' ? { kind: 'relay', code } : { kind: 'app', code };
}

async function errorCode(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  return isRecord(body) && typeof body.error === 'string' ? body.error : 'server-error';
}

async function answered(response: Response | RelayFailure): Promise<Response | RelayFailure> {
  if (!(response instanceof Response) || response.ok) return response;
  return { kind: 'provider', status: response.status, detail: providerMessage(await response.text().catch(() => '')) };
}

export async function relay(request: HttpRequest, signal?: AbortSignal): Promise<Response | RelayFailure> {
  return answered(await send(request, signal));
}

// For requests whose whole answer is one JSON document, such as a model list.
export async function relayJson(request: HttpRequest, signal?: AbortSignal): Promise<JsonAnswer> {
  return readJson(await relay(request, signal), signal);
}

// OAuth puts its refusals in a JSON body for the caller to read: RFC 8628 answers "not yet" with a 400.
export async function relayOAuth(request: HttpRequest, signal?: AbortSignal): Promise<JsonAnswer> {
  return readJson(await send(request, signal), signal);
}

async function readJson(response: Response | RelayFailure, signal?: AbortSignal): Promise<JsonAnswer> {
  if (!(response instanceof Response)) return { ok: false, failure: response };
  let text: string;
  try {
    text = await response.text();
  } catch {
    return { ok: false, failure: lost(signal) };
  }
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, failure: { kind: 'provider', status: response.status, detail: text.trim().slice(0, 300) } };
  }
}

// A generation call through its ReplyStream on the server (tech-spec §6, Detached replies), which goes on when this
// page stops reading. With a request it starts the call; without one it reads the call already started, from the
// start. The answer is the provider's as relay gives it. key: the call's private key; public: its public half, to start.
// took: how long the call ran, as the server measured it, once its end has been read.
export type StreamCall = { id: string; key: JsonWebKey; public?: string; took?: number };

export async function stream(call: StreamCall, request: HttpRequest | null, signal: AbortSignal): Promise<Response | RelayFailure> {
  let response: Response;
  try {
    response = await fetch(
      `/api/streams/${call.id}`,
      request ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: call.public, request }), signal } : { signal },
    );
  } catch {
    return lost(signal);
  }
  if (response.headers.get('x-stream') !== 'frames' || !response.body) return { kind: 'app', code: await errorCode(response) };
  return answered(await unframe(call, response.body, signal));
}

// 멈추기: the call ends and the server keeps what came. A refused stop leaves the call running until it is dropped.
export const stopStream = (id: string) => void fetch(`/api/streams/${id}/stop`, { method: 'POST', headers: { 'content-type': 'application/json' } }).catch(() => {});

// Once the call's result is saved. A refused drop leaves the server's copy until it expires on its own.
export const dropStream = (id: string) => void fetch(`/api/streams/${id}`, { method: 'DELETE', headers: { 'content-type': 'application/json' } }).catch(() => {});

// Frame types and layout as server/stream-box writes them.
const HEAD = 1;
const DATA = 2;
const END = 3;
const NO_BODY = new Set([101, 204, 205, 304]);

async function unframe(call: StreamCall, body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<Response | RelayFailure> {
  const frames = framesOf(call.id, body, signal);
  let open: Awaited<ReturnType<typeof streamOpener>>;
  let head: { status: number; statusText: string; headers: [string, string][] };
  try {
    const hello = await frames.next();
    if (hello.done) return { kind: 'app', code: 'stream-lost' };
    open = await streamOpener(call.id, call.key, hello.value.body);
    const sealed = await frames.next();
    const opened = !sealed.done && sealed.value.type === HEAD ? await open(sealed.value.type, sealed.value.seq, sealed.value.body) : null;
    if (!opened) return { kind: 'app', code: 'stream-lost' };
    head = JSON.parse(new TextDecoder().decode(opened)) as typeof head;
  } catch {
    return lost(signal);
  }
  const lostStream = new Error('The server lost this call before it ended.');
  const data = new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      const frame = await frames.next();
      const opened = !frame.done && (await open(frame.value.type, frame.value.seq, frame.value.body));
      if (frame.done || !opened) return controller.error(lostStream);
      if (frame.value.type === DATA) return controller.enqueue(opened);
      if (frame.value.type !== END) return controller.error(lostStream);
      const end = JSON.parse(new TextDecoder().decode(opened)) as { reason: string; detail?: string; ms: number };
      call.took = end.ms;
      if (end.reason === 'network') controller.error(new Error(end.detail));
      else controller.close();
    },
    cancel: () => void frames.return(undefined),
  });
  return sourced(new Response(NO_BODY.has(head.status) ? null : data, { status: head.status, statusText: head.statusText, headers: head.headers }));
}

// The frames of a call, hello first. A connection that breaks while the page still wants the call (a phone putting
// the tab to sleep, a network change) is read again from the frame after the last one, a few times before it fails.
async function* framesOf(id: string, first: ReadableStream<Uint8Array>, signal: AbortSignal) {
  let body = first;
  let next = 0;
  for (let tries = 0; ; tries++) {
    try {
      for await (const frame of split(body)) {
        if (frame.seq !== 0 && frame.seq < next) continue;
        if (frame.seq === 0 && next > 0) continue;
        next = frame.seq + 1;
        tries = 0;
        yield frame;
      }
      return;
    } catch (error) {
      if (signal.aborted || tries >= RECONNECTS) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** tries));
    const again = await fetch(`/api/streams/${id}?from=${next}`, { signal }).catch(() => null);
    if (again?.headers.get('x-stream') === 'frames' && again.body) body = again.body;
    else if (again) return;
  }
}

const RECONNECTS = 3;

// [u32 length][u8 type][u32 seq][body], as server/stream-box writes them.
async function* split(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  let buffer = new Uint8Array(0);
  try {
    for (;;) {
      while (buffer.byteLength >= 4) {
        const view = new DataView(buffer.buffer, buffer.byteOffset);
        const length = view.getUint32(0);
        if (buffer.byteLength < 4 + length) break;
        yield { type: view.getUint8(4), seq: view.getUint32(5), body: buffer.slice(9, 4 + length) };
        buffer = buffer.slice(4 + length);
      }
      const { done, value } = await reader.read();
      if (done) return;
      const joined = new Uint8Array(buffer.byteLength + value.byteLength);
      joined.set(buffer);
      joined.set(value, buffer.byteLength);
      buffer = joined;
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}
