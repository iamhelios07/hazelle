import { RELAY_HEADER } from '../contracts/http';
import { PolicyRefusal } from './ssrf';

export type UpstreamInit = {
  method: string;
  headers: Headers;
  body: string | null;
  redirect: 'manual';
  signal: AbortSignal;
};

// Rejects with PolicyRefusal for a destination the outbound policy refuses (outbound.ts), with anything else for a call
// that failed on the way.
export type Upstream = (url: URL, init: UpstreamInit) => Promise<Response>;

export type RelayError = 'bad-envelope' | 'not-https' | 'not-public' | 'upstream-unreachable' | 'upstream-redirect';

type Envelope = { url: URL; method: string; headers: Record<string, string>; body: string | null };

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

const DROPPED_REQUEST_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'cookie',
  'content-length',
  'forwarded',
  'x-real-ip',
]);
const DROPPED_REQUEST_PREFIXES = ['x-forwarded-', 'cf-'];

// fetch decodes the body, so content-encoding and content-length would describe bytes the client
// never receives. www-authenticate is dropped so a provider 401 cannot open the browser's login prompt.
// The last group is applied by the browser to this app's origin, not the provider's: a connection
// could otherwise wipe the session and vault cache (clear-site-data) or redirect error reports.
const DROPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'set-cookie',
  'content-encoding',
  'content-length',
  'www-authenticate',
  'clear-site-data',
  'nel',
  'report-to',
  'reporting-endpoints',
  'strict-transport-security',
  'alt-svc',
]);

export function createRelay(upstream: Upstream): (request: Request) => Promise<Response> {
  return async (request) => forward(upstream, await request.json().catch(() => null), request.signal);
}

// stream-box.ts calls it with a signal of its own, so the call outlives the client's request.
export async function forward(upstream: Upstream, body: unknown, signal: AbortSignal): Promise<Response> {
  const envelope = parseEnvelope(body);
  if (!envelope) return refuse(400, 'bad-envelope');

  let response: Response;
  try {
    response = await upstream(envelope.url, {
      method: envelope.method,
      headers: outboundHeaders(envelope.headers),
      body: envelope.body,
      redirect: 'manual',
      signal,
    });
  } catch (error) {
    return error instanceof PolicyRefusal ? refuse(403, error.refusal) : refuse(502, 'upstream-unreachable');
  }

  // A browser fetch would follow a relayed 3xx on its own, so the redirect is reported instead.
  if (REDIRECTS.has(response.status)) {
    await response.body?.cancel();
    return refuse(502, 'upstream-redirect', { status: response.status, location: response.headers.get('location') });
  }

  const headers = new Headers();
  response.headers.forEach((value, name) => {
    if (!DROPPED_RESPONSE_HEADERS.has(name)) headers.set(name, value);
  });
  headers.set(RELAY_HEADER, 'upstream');
  headers.set('cache-control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function parseEnvelope(value: unknown): Envelope | null {
  if (typeof value !== 'object' || value === null) return null;
  const { url, method, headers, body } = value as Record<string, unknown>;
  if (typeof url !== 'string' || !URL.canParse(url)) return null;
  if (typeof method !== 'string' || !METHODS.has(method)) return null;
  if (typeof headers !== 'object' || headers === null) return null;
  if (!Object.values(headers).every((v) => typeof v === 'string')) return null;
  if (body !== null && typeof body !== 'string') return null;
  if (method === 'GET' && body !== null) return null;
  return { url: new URL(url), method, headers: headers as Record<string, string>, body };
}

function outboundHeaders(input: Record<string, string>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(input)) {
    const key = name.toLowerCase();
    if (DROPPED_REQUEST_HEADERS.has(key) || DROPPED_REQUEST_PREFIXES.some((p) => key.startsWith(p))) continue;
    headers.set(key, value);
  }
  return headers;
}

function refuse(status: number, error: RelayError, detail: Record<string, unknown> = {}): Response {
  return Response.json({ error, ...detail }, { status, headers: { [RELAY_HEADER]: 'error', 'cache-control': 'no-store' } });
}
