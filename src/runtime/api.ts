import { ACCOUNT_HEADER, RELAY_HEADER, ACCOUNT_USAGE_HEADERS } from '../contracts/http';
import { isRecord } from '../connectors/values';

export type ApiFailure = { ok: false; error: string; retryAfter?: number; status?: number };
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

// What an answer says of the account the page holds rather than of the request.
export type Heard = { kind: 'elsewhere' } | { kind: 'suspended' } | { kind: 'storage-full' } | { kind: 'restoring' } | { kind: 'bytes'; bytes: number } | { kind: 'file-bytes'; fileBytes: number };

const REFUSALS: Record<string, 'elsewhere' | 'suspended' | 'storage-full' | 'restoring'> = {
  'account-mismatch': 'elsewhere',
  suspended: 'suspended',
  'storage-full': 'storage-full',
  'account-restoring': 'restoring',
};

// Every request states it, and the server refuses one whose cookie has come to name another account (server/session).
let held: string | null = null;
let hear: ((heard: Heard) => void) | null = null;

export function holdAccount(account: string | null, onHeard: ((heard: Heard) => void) | null = null) {
  held = account;
  hear = onHeard;
}

// Every request to this app's server leaves through here (api, and runtime/relay's raw ones).
export async function fetchApi(path: string, init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {}): Promise<Response> {
  const response = await fetch(`/api/${path}`, { ...init, headers: { ...(held === null ? {} : { [ACCOUNT_HEADER]: held }), ...init.headers } });
  const tell = hear;
  if (!tell) return response;
  const bytes = response.headers.get(ACCOUNT_USAGE_HEADERS.bytes);
  const fileBytes = response.headers.get(ACCOUNT_USAGE_HEADERS.fileBytes);
  if (bytes !== null) tell({ kind: 'bytes', bytes: Number(bytes) });
  if (fileBytes !== null) tell({ kind: 'file-bytes', fileBytes: Number(fileBytes) });
  // A provider's refusal comes through the relay marked x-relay, and its body is the provider's to read.
  if ((response.status === 403 || response.status === 409 || response.status === 413 || response.status === 503) && !response.headers.has(RELAY_HEADER)) {
    const body: unknown = await response.clone().json().catch(() => null);
    const kind = isRecord(body) && typeof body.error === 'string' ? REFUSALS[body.error] : undefined;
    if (kind === 'elsewhere') hear = null;
    if (kind) tell({ kind });
  }
  return response;
}

// Headers come only once the whole request body has gone up, so their wait grows with the body at SLOWEST_UPLOAD bytes
// a second: a slow phone uplink shared by runtime/files' 12 parallel uploads of up to 25 MB each. The answer's body is
// read with no timer. Never move this into fetchApi: the relay's streams are read through it.
const HEADERS_WAIT = 15_000;
const SLOWEST_UPLOAD = 16_384;
// For a route whose server work runs inside the request and can outlast HEADERS_WAIT: 탈퇴's store wipe, an operator's
// account removal or restore. Timed out, such a request reads as 'offline' while the server may still finish it.
export const SLOW_ROUTE_WAIT = 5 * 60_000;

// 'offline' means no whole answer came: the request never reached the server, its headers did not come in time, or the
// connection dropped while its answer was being read, or a 5xx without the JSON error shape every API route uses, which
// the proxy in front wrote while the app was not answering (a container swap, Cloudflare's 52x). 'server-error' means
// an answer that was neither, with its status.
export async function api<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, signal?: AbortSignal, headersWait = HEADERS_WAIT): Promise<ApiResult<T>> {
  const bytes = body instanceof Uint8Array ? (body as Uint8Array<ArrayBuffer>) : null;
  const payload = body === undefined ? undefined : (bytes ?? JSON.stringify(body));
  const late = new AbortController();
  const timer = setTimeout(() => late.abort(), headersWait + ((payload?.length ?? 0) / SLOWEST_UPLOAD) * 1000);
  let response: Response;
  let answer: Uint8Array | string;
  try {
    try {
      response = await fetchApi(path, {
        method,
        signal: signal ? AbortSignal.any([signal, late.signal]) : late.signal,
        headers: method === 'GET' ? {} : { 'content-type': bytes ? 'application/octet-stream' : 'application/json' },
        body: payload,
      });
    } finally {
      clearTimeout(timer);
    }
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
  if (response.status >= 500) return { ok: false, error: 'offline' };
  return { ok: false, error: 'server-error', status: response.status };
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Writes sent together, each shown at once: the first failure among them, or ok once all landed.
export async function allWritten(writes: Promise<ApiResult<unknown>>[]): Promise<ApiResult<null>> {
  const results = await Promise.all(writes);
  return results.find((result): result is ApiFailure => !result.ok) ?? { ok: true, data: null };
}
