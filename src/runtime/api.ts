import { isRecord } from '../connectors/values';

export type ApiFailure = { ok: false; error: string; retryAfter?: number };
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

// A Uint8Array body goes out as bytes, and a byte answer comes back as a Uint8Array; everything else
// is JSON. 'offline' means the request never reached the server; 'server-error' means it answered
// without the JSON error shape every API route uses.
export async function api<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<ApiResult<T>> {
  const bytes = body instanceof Uint8Array ? (body as Uint8Array<ArrayBuffer>) : null;
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      method,
      headers: method === 'GET' ? {} : { 'content-type': bytes ? 'application/octet-stream' : 'application/json' },
      body: body === undefined ? undefined : (bytes ?? JSON.stringify(body)),
    });
  } catch {
    return { ok: false, error: 'offline' };
  }
  if (response.status === 204) return { ok: true, data: undefined as T };
  const readBytes = response.ok && response.headers.get('content-type') === 'application/octet-stream';
  const data: unknown = await (readBytes ? response.arrayBuffer().then((buffer) => new Uint8Array(buffer)) : response.json()).catch(() => null);
  if (response.ok && data !== null) return { ok: true, data: data as T };
  if (isRecord(data) && typeof data.error === 'string') {
    const retryAfter = typeof data.retryAfter === 'number' ? data.retryAfter : undefined;
    return { ok: false, error: data.error, retryAfter };
  }
  return { ok: false, error: 'server-error' };
}
