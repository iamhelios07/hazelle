import { isRecord } from '../connectors/values';

export type ApiFailure = { ok: false; error: string; retryAfter?: number };
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

// A Uint8Array body goes out as bytes, and a byte answer comes back as a Uint8Array; everything else
// is JSON. 'offline' means no whole answer came: the request never reached the server, or the connection
// dropped while its answer was being read. 'server-error' means it answered without the JSON error shape
// every API route uses.
export async function api<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, signal?: AbortSignal): Promise<ApiResult<T>> {
  const bytes = body instanceof Uint8Array ? (body as Uint8Array<ArrayBuffer>) : null;
  let response: Response;
  let answer: Uint8Array | string;
  try {
    response = await fetch(`/api/${path}`, {
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
