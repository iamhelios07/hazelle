import { providerMessage } from '../connectors/errors';
import type { HttpRequest } from '../connectors/types';

// Whose refusal it was decides what the user is told (tech-spec §6): the provider's answer, the relay's
// own refusal (X-Relay: error), the app's (no X-Relay header, such as an expired session), or no
// connection at all.
export type RelayFailure =
  | { kind: 'provider'; status: number; detail: string }
  | { kind: 'relay'; code: string }
  | { kind: 'app'; code: string }
  | { kind: 'offline' }
  | { kind: 'stopped' };

export async function relay(request: HttpRequest, signal?: AbortSignal): Promise<Response | RelayFailure> {
  let response: Response;
  try {
    response = await fetch('/api/relay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
  } catch {
    return signal?.aborted ? { kind: 'stopped' } : { kind: 'offline' };
  }
  const source = response.headers.get('x-relay');
  if (source === 'upstream') {
    if (response.ok) return response;
    return { kind: 'provider', status: response.status, detail: providerMessage(await response.text().catch(() => '')) };
  }
  const body: unknown = await response.json().catch(() => null);
  const code = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string' ? body.error : 'server-error';
  return source === 'error' ? { kind: 'relay', code } : { kind: 'app', code };
}

// For requests whose whole answer is one JSON document, such as a model list.
export async function relayJson(request: HttpRequest): Promise<{ ok: true; data: unknown } | { ok: false; failure: RelayFailure }> {
  const response = await relay(request);
  if (!(response instanceof Response)) return { ok: false, failure: response };
  const text = await response.text();
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, failure: { kind: 'provider', status: response.status, detail: text.trim().slice(0, 300) } };
  }
}
