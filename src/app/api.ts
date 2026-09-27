export type ApiFailure = { ok: false; error: string; retryAfter?: number };
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

// 'offline' means the request never reached the server; 'server-error' means it answered without
// the JSON error shape every API route uses.
export async function api<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      method,
      headers: method === 'POST' ? { 'content-type': 'application/json' } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: 'offline' };
  }
  if (response.status === 204) return { ok: true, data: undefined as T };
  const data: unknown = await response.json().catch(() => null);
  if (response.ok && data !== null) return { ok: true, data: data as T };
  if (typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string') {
    const retryAfter = 'retryAfter' in data && typeof data.retryAfter === 'number' ? data.retryAfter : undefined;
    return { ok: false, error: data.error, retryAfter };
  }
  return { ok: false, error: 'server-error' };
}
