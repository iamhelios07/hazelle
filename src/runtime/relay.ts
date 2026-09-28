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

export type JsonAnswer = { ok: true; data: unknown } | { ok: false; failure: RelayFailure };

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
    return signal?.aborted ? { kind: 'stopped' } : { kind: 'offline' };
  }
  const source = response.headers.get('x-relay');
  if (source === 'upstream') return response;
  const body: unknown = await response.json().catch(() => null);
  const code = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string' ? body.error : 'server-error';
  return source === 'error' ? { kind: 'relay', code } : { kind: 'app', code };
}

export async function relay(request: HttpRequest, signal?: AbortSignal): Promise<Response | RelayFailure> {
  const response = await send(request, signal);
  if (!(response instanceof Response) || response.ok) return response;
  return { kind: 'provider', status: response.status, detail: providerMessage(await response.text().catch(() => '')) };
}

// For requests whose whole answer is one JSON document, such as a model list.
export async function relayJson(request: HttpRequest, signal?: AbortSignal): Promise<JsonAnswer> {
  return readJson(await relay(request, signal));
}

// OAuth puts its refusals in a JSON body for the caller to read: RFC 8628 answers "not yet" with a 400.
export async function relayOAuth(request: HttpRequest, signal?: AbortSignal): Promise<JsonAnswer> {
  return readJson(await send(request, signal));
}

async function readJson(response: Response | RelayFailure): Promise<JsonAnswer> {
  if (!(response instanceof Response)) return { ok: false, failure: response };
  const text = await response.text();
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, failure: { kind: 'provider', status: response.status, detail: text.trim().slice(0, 300) } };
  }
}
