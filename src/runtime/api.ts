import { isRecord } from '../connectors/values';

export type ApiFailure = { ok: false; error: string; retryAfter?: number };
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

// What an answer says of the account the page holds rather than of the request: that the cookie has come to name
// another account (elsewhere, told once), that the operator suspended it, that a write was refused for room, or the
// account's counts after a write or a sync, or that the operator is restoring it. The header names are the server's
// USE_HEADERS (server/caps).
export type Heard = { kind: 'elsewhere' } | { kind: 'suspended' } | { kind: 'storage-full' } | { kind: 'restoring' } | { kind: 'bytes'; bytes: number } | { kind: 'file-bytes'; fileBytes: number };

const COUNTS = { bytes: 'x-account-bytes', fileBytes: 'x-account-file-bytes' } as const;
const REFUSALS: Record<string, 'elsewhere' | 'suspended' | 'storage-full' | 'restoring'> = {
  'account-mismatch': 'elsewhere',
  suspended: 'suspended',
  'storage-full': 'storage-full',
  'account-restoring': 'restoring',
};

// The account this page is open as. Every request states it, and the server refuses one whose cookie has come to name
// another account, as it does once another tab signs in as someone else (server/session).
let held: string | null = null;
let hear: ((heard: Heard) => void) | null = null;

export function holdAccount(account: string | null, onHeard: ((heard: Heard) => void) | null = null) {
  held = account;
  hear = onHeard;
}

// Every request to this app's server leaves through here (api, and runtime/relay's raw ones), so each states the
// account and the page hears what every answer says of it.
export async function fetchApi(path: string, init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {}): Promise<Response> {
  const response = await fetch(`/api/${path}`, { ...init, headers: { ...(held === null ? {} : { 'x-account': held }), ...init.headers } });
  const tell = hear;
  if (!tell) return response;
  const bytes = response.headers.get(COUNTS.bytes);
  const fileBytes = response.headers.get(COUNTS.fileBytes);
  if (bytes !== null) tell({ kind: 'bytes', bytes: Number(bytes) });
  if (fileBytes !== null) tell({ kind: 'file-bytes', fileBytes: Number(fileBytes) });
  // A provider's refusal comes through the relay marked x-relay, and its body is the provider's to read.
  if ((response.status === 403 || response.status === 409 || response.status === 413 || response.status === 503) && !response.headers.has('x-relay')) {
    const body: unknown = await response.clone().json().catch(() => null);
    const kind = isRecord(body) && typeof body.error === 'string' ? REFUSALS[body.error] : undefined;
    if (kind === 'elsewhere') hear = null;
    if (kind) tell({ kind });
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
