import { isRecord } from '../connectors/values';

export type ApiFailure = { ok: false; error: string; retryAfter?: number };
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

// The account this page is open as. Every request states it, and the server refuses one whose cookie has come to name
// another account, as it does once another tab signs in as someone else (server/session). onLost hears of that once.
let held: string | null = null;
let lost: (() => void) | null = null;

export function holdAccount(account: string | null, onLost: (() => void) | null = null) {
  held = account;
  lost = onLost;
}

// Every request to this app's server leaves through here (api, and runtime/relay's raw ones), so each states the
// account and every refusal for naming another reaches onLost.
export async function fetchApi(path: string, init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {}): Promise<Response> {
  const response = await fetch(`/api/${path}`, { ...init, headers: { ...(held === null ? {} : { 'x-account': held }), ...init.headers } });
  if (response.status === 409) {
    const body: unknown = await response.clone().json().catch(() => null);
    if (isRecord(body) && body.error === 'account-mismatch') {
      const tell = lost;
      lost = null;
      tell?.();
    }
  }
  return response;
}

// A Uint8Array body goes out as bytes, and a byte answer comes back as a Uint8Array; everything else
// is JSON. 'offline' means no whole answer came: the request never reached the server, or the connection
// dropped while its answer was being read. 'server-error' means it answered without the JSON error shape
// every API route uses.
export async function api<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, signal?: AbortSignal): Promise<ApiResult<T>> {
  const bytes = body instanceof Uint8Array ? (body as Uint8Array<ArrayBuffer>) : null;
  let response: Response;
  let answer: Uint8Array | string;
  try {
    response = await fetchApi(path, {
      method,
      signal,
      headers: method === 'GET' ? {} : { 'content-type': bytes ? 'application/octet-stream' : 'application/json' },
      body: body === undefined ? undefined : (bytes ?? JSON.stringify(body)),
    });
    if (response.status === 204) return { ok: true, data: undefined as T };
    const readBytes = response.ok && response.headers.get('content-type') === 'application/octet-stream';
    answer = readBytes ? new Uint8Array(await response.arrayBuffer()) : await response.text();
  } catch {
    return { ok: false, error: signal?.aborted ? 'stopped' : 'offline' };
  }
  if (signal?.aborted) return { ok: false, error: 'stopped' };
  const data = typeof answer === 'string' ? parse(answer) : answer;
  if (response.ok && data !== null) return { ok: true, data: data as T };
  if (isRecord(data) && typeof data.error === 'string') {
    const retryAfter = typeof data.retryAfter === 'number' ? data.retryAfter : undefined;
    return { ok: false, error: data.error, retryAfter };
  }
  return { ok: false, error: 'server-error' };
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
