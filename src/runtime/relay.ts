import type { ModelSettings } from '../connectors/settings';
import type { ApiResult } from './api';
import type { PreparedChat } from '../connectors/preparation';
import type { CallCalibration, InputMeasurement, TokenFit } from '../model/token-calibration';
import { BOT_HEADER, RELAY_HEADER } from '../contracts/http';
import { HEAD, DATA, END, PING, WAIT, type Retry } from '../contracts/streams';
import { providerCode, providerMessage } from '../connectors/errors';
import { isRecord } from '../connectors/values';
import type { HttpRequest } from '../connectors/types';
import { streamOpener } from '../vault/streams';
import { fetchApi } from './api';
import { pause } from './pause';

// Whose refusal it was decides what the user is told: the provider's answer, the relay's
// own refusal (X-Relay: error), the app's (no X-Relay header, such as an expired session), or no
// connection at all. code: the provider's own name for its refusal, where its body gives one; retryAfter: its
// Retry-After header.
export type RelayFailure =
  | { kind: 'provider'; status: number; detail: string; code?: string; retryAfter?: string }
  | { kind: 'relay'; code: string }
  | { kind: 'app'; code: string }
  | { kind: 'offline' }
  | { kind: 'stopped' };

export type JsonAnswer = { ok: true; data: unknown } | { ok: false; failure: RelayFailure };

const lost = (signal?: AbortSignal): RelayFailure => (signal?.aborted ? { kind: 'stopped' } : { kind: 'offline' });

// The provider's answer, whatever its status. bot: the chat whose bot's script makes the call (BOT_HEADER).
async function send(request: HttpRequest, signal?: AbortSignal, bot?: string): Promise<Response | RelayFailure> {
  let response: Response;
  try {
    response = await fetchApi('relay', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(bot !== undefined && { [BOT_HEADER]: bot }) },
      body: JSON.stringify(request),
      signal,
    });
  } catch {
    return lost(signal);
  }
  return sourced(response);
}

async function sourced(response: Response): Promise<Response | RelayFailure> {
  const source = response.headers.get(RELAY_HEADER);
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
  const text = await response.text().catch(() => '');
  const code = providerCode(text);
  const retryAfter = response.headers.get('retry-after');
  return { kind: 'provider', status: response.status, detail: providerMessage(text), ...(code !== null && { code }), ...(retryAfter !== null && { retryAfter }) };
}

export async function relay(request: HttpRequest, signal?: AbortSignal, bot?: string): Promise<Response | RelayFailure> {
  return answered(await send(request, signal, bot));
}

export async function relayJson(request: HttpRequest, signal?: AbortSignal, bot?: string): Promise<JsonAnswer> {
  return readJson(await relay(request, signal, bot), signal);
}

export type BytesAnswer = { ok: true; bytes: Uint8Array<ArrayBuffer>; type: string | null } | { ok: false; failure: RelayFailure };

// A body that is not text, such as a picture, with its content type.
export async function relayBytes(request: HttpRequest, signal?: AbortSignal): Promise<BytesAnswer> {
  const response = await relay(request, signal);
  if (!(response instanceof Response)) return { ok: false, failure: response };
  try {
    return { ok: true, bytes: new Uint8Array(await response.arrayBuffer()), type: response.headers.get('content-type') };
  } catch {
    return { ok: false, failure: lost(signal) };
  }
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

// A generation call through server/stream-box (tech-spec §6, Detached replies), which goes on when this
// page stops reading. With a request it starts the call; without one it reads the call already started, from the
// start. key: the call's private key; public: its public half, to start.
// started: told once the server holds the call, before any of it is read, or once a discount lane's batch does (its
// id, runtime/generate). retrying: told each time a try failed and is to be sent again (Retry). bot: the chat whose
// bot's script makes the call, which the server limits per chat. tries: how many times the server sent it, once its
// head has been read. took: how long the call ran, as the server measured it, once its end has been read.
export type StreamCall = { preflight?: (settings: ModelSettings, signal: AbortSignal) => Promise<ApiResult<TokenFit>>; calibration?: CallCalibration; measure?: (prepared: PreparedChat) => Promise<InputMeasurement>; id: string; key: JsonWebKey; public?: string; started?: (batch?: string) => void; retrying?: () => void; bot?: string; took?: number; tries?: number };

// A read ends only at the call's own end: the end the server read, a call the server lost, or one it no longer holds
// (stream-gone); or once the session is gone (no-session), when no read can reach it. This page's other failures to
// reach it are tried again until the page stops reading; failing the read on them would save that failure as the
// call's result and drop a call still running.
// retry: how the server sends again a try that failed before any of it came, absent for none.
export async function stream(call: StreamCall, request: HttpRequest | null, signal: AbortSignal, retry: Retry | null = null): Promise<Response | RelayFailure> {
  let body: ReadableStream<Uint8Array>;
  if (request) {
    let response: Response;
    try {
      response = await fetchApi(`streams/${call.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: call.public, request, ...(call.bot && { bot: call.bot }), ...(retry && { retry }) }), signal });
    } catch {
      return lost(signal);
    }
    if (response.headers.get('x-stream') !== 'frames' || !response.body) return { kind: 'app', code: await errorCode(response) };
    // A call stopped as its start was answered gets no marker: whoever stopped it ends it, and a marker landing after
    // that end would be picked up as a call to save.
    if (signal.aborted) return lost(signal);
    call.started?.();
    body = response.body;
  } else {
    let reached: ReadableStream<Uint8Array> | RelayFailure;
    try {
      reached = await reach(call.id, 0, 0, signal);
    } catch {
      return lost(signal);
    }
    if (!(reached instanceof ReadableStream)) return reached;
    body = reached;
  }
  return answered(await unframe(call, body, signal));
}

// 멈추기: the call ends and the server keeps what came. A refused stop leaves the call running until it is dropped.
export const stopStream = (id: string) => void fetchApi(`streams/${id}/stop`, { method: 'POST', headers: { 'content-type': 'application/json' } }).catch(() => {});

// Once the call's result is saved. A refused drop leaves the server's copy until it expires on its own.
export const dropStream = (id: string) => void fetchApi(`streams/${id}`, { method: 'DELETE', headers: { 'content-type': 'application/json' } }).catch(() => {});

// No connection or a server error are this page's and are tried again, ever more slowly; stream-gone: the server
// holds no such call; no-session: the session is gone. Throws once signal stops the read.
async function reach(id: string, from: number, tries: number, signal: AbortSignal): Promise<ReadableStream<Uint8Array> | RelayFailure> {
  for (; ; tries++) {
    if (tries) await pause(Math.min(1000 * 2 ** (tries - 1), 30_000), signal);
    signal.throwIfAborted();
    const response = await fetchApi(`streams/${id}?from=${from}`, { signal }).catch(() => null);
    if (response?.headers.get('x-stream') === 'frames' && response.body) return response.body;
    if (response?.status === 404) return { kind: 'app', code: 'stream-gone' };
    if (response?.status === 401) return { kind: 'app', code: await errorCode(response) };
  }
}

const NO_BODY = new Set([101, 204, 205, 304]);

async function unframe(call: StreamCall, body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<Response | RelayFailure> {
  const frames = framesOf(call.id, body, signal);
  let open: Awaited<ReturnType<typeof streamOpener>>;
  let head: { status: number; statusText: string; headers: [string, string][]; tries?: number };
  const ending = (opened: Uint8Array) => {
    const end = JSON.parse(new TextDecoder().decode(opened)) as { reason: string; detail?: string; ms: number };
    call.took = end.ms;
    return end;
  };
  try {
    const hello = await frames.next();
    if (hello.done) return { kind: 'app', code: 'stream-lost' };
    open = await streamOpener(call.id, call.key, hello.value.body);
    let sealed = await frames.next();
    while (!sealed.done && sealed.value.type === WAIT && (await open(sealed.value.type, sealed.value.seq, sealed.value.body))) {
      call.retrying?.();
      sealed = await frames.next();
    }
    const opened = !sealed.done && (sealed.value.type === HEAD || sealed.value.type === END) ? await open(sealed.value.type, sealed.value.seq, sealed.value.body) : null;
    if (!opened) return { kind: 'app', code: 'stream-lost' };
    // A call ends before its head only while a try waits to be sent again: stopped, or cut at its time.
    if (sealed.value!.type === END) return ending(opened).reason === 'stopped' ? { kind: 'stopped' } : { kind: 'app', code: 'stream-lost' };
    head = JSON.parse(new TextDecoder().decode(opened)) as typeof head;
    call.tries = head.tries;
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
      const end = ending(opened);
      if (end.reason === 'network') controller.error(new Error(end.detail));
      else controller.close();
    },
    cancel: () => void frames.return(undefined),
  });
  return sourced(new Response(NO_BODY.has(head.status) ? null : data, { status: head.status, statusText: head.statusText, headers: head.headers }));
}

// A connection that breaks while the page still wants the call (a phone putting the tab to sleep, a network change)
// is read again from the frame after the last one.
async function* framesOf(id: string, first: ReadableStream<Uint8Array>, signal: AbortSignal) {
  let body = first;
  let next = 0;
  for (let tries = 0; ; tries++) {
    try {
      for await (const frame of split(body)) {
        if (frame.type === PING) continue;
        if (frame.seq !== 0 && frame.seq < next) continue;
        if (frame.seq === 0 && next > 0) continue;
        next = frame.seq + 1;
        tries = 0;
        yield frame;
      }
      return;
    } catch (error) {
      if (signal.aborted) throw error;
    }
    const again = await reach(id, next, tries, signal);
    if (!(again instanceof ReadableStream)) return;
    body = again;
  }
}

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
