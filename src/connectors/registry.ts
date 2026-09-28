import { anthropic } from './anthropic';
import { anthropicMessages } from './anthropic-messages';
import { chatCompletions } from './chat-completions';
import { copilot } from './copilot';
import { openRouter } from './openrouter';
import { ConnectorError, type ChatRequest, type Codec, type Connection, type ConnectionType, type Endpoint, type HttpRequest, type Model, type SignIn } from './types';

// Adding a provider means adding its connection type here (design §4). Nothing else names one.
const BUILT_IN: ConnectionType[] = [openRouter, anthropic, copilot];

// The types connected by signing in, each offered as its own button next to the key field (design F5).
export const SIGN_IN_TYPES = BUILT_IN.filter((type): type is ConnectionType & { signIn: SignIn } => type.signIn !== undefined);

// The type of a connection the user described by address and protocol.
export const GENERIC = 'generic';

// Keyed by any string: a stored connection or model snapshot may name a protocol that only a newer
// version of the app speaks.
const CODECS: Partial<Record<string, Codec>> = { 'chat-completions': chatCompletions, 'anthropic-messages': anthropicMessages };

export type Resolved = { type: ConnectionType | null; endpoint: Endpoint; codec: Codec };

// null for a type this version does not know, such as one saved by a newer version of the app.
export function resolveConnection(connection: Connection): Resolved | null {
  if (connection.type === GENERIC) {
    const codec = connection.protocol && CODECS[connection.protocol];
    if (!connection.baseUrl || !connection.protocol || !codec) return null;
    return { type: null, endpoint: { baseUrl: connection.baseUrl, protocol: connection.protocol }, codec };
  }
  const type = BUILT_IN.find((candidate) => candidate.id === connection.type);
  return type ? { type, endpoint: type.endpoint, codec: CODECS[type.endpoint.protocol]! } : null;
}

// The address and codec one model is called through: the connection's own, or the route its type
// gives for the protocol the model names.
export function resolveModel(resolved: Resolved, model: Model): Resolved {
  const protocol = model.protocol ?? resolved.endpoint.protocol;
  if (protocol === resolved.endpoint.protocol) return resolved;
  const baseUrl = protocol !== 'unsupported' && resolved.type?.routes?.[protocol];
  const codec = CODECS[protocol];
  if (protocol === 'unsupported' || !baseUrl || !codec) throw new ConnectorError('unsupported-protocol');
  return { type: resolved.type, endpoint: { baseUrl, protocol }, codec };
}

export function catalogRequest({ codec, endpoint }: Resolved): HttpRequest {
  return codec.listModels(endpoint);
}

export function parseCatalog({ type, codec }: Resolved, payload: unknown): Model[] | null {
  return (type?.parseModels ?? codec.parseModels)(payload);
}

export function chatRequest({ codec, endpoint }: Resolved, request: ChatRequest): HttpRequest {
  return codec.chat(endpoint, request);
}

// The credential is the stored key, or the token a connection type traded it for.
export function withCredential({ type, codec }: Resolved, request: HttpRequest, credential: string): HttpRequest {
  return { ...request, headers: { ...request.headers, ...(type?.headers ?? codec.authHeaders)(credential) } };
}

export type Detection =
  | { kind: 'key'; type: ConnectionType; secret: string }
  | { kind: 'url'; type: ConnectionType }
  | { kind: 'generic-url'; baseUrl: string; problem: 'not-https' | 'local' | null }
  | { kind: 'unknown-key'; secret: string };

// F5: one pasted value, recognized by key shape or host.
export function detect(input: string): Detection | null {
  const text = input.trim();
  if (!text) return null;
  const baseUrl = normalizeBaseUrl(text);
  if (baseUrl) {
    const url = new URL(baseUrl);
    const type = BUILT_IN.find((candidate) => candidate.detect?.host === url.hostname);
    if (type) return { kind: 'url', type };
    return { kind: 'generic-url', baseUrl, problem: url.protocol !== 'https:' ? 'not-https' : isLocal(url.hostname) ? 'local' : null };
  }
  if (/\s/.test(text)) return null;
  const type = BUILT_IN.find((candidate) => candidate.detect?.key?.test(text));
  return type ? { kind: 'key', type, secret: text } : { kind: 'unknown-key', secret: text };
}

// Accepts an address copied from a provider's docs, with or without an endpoint path on the end.
export function normalizeBaseUrl(text: string): string | null {
  if (!/^https?:\/\//i.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, '').replace(/\/(chat\/completions|messages|models)$/, '');
  return `${url.origin}${path}`;
}

// The hosted relay can never reach these (tech-spec §6), so the form says so before the first try.
// Other LAN names cannot be recognized in advance and fail on first use.
function isLocal(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    /\.(localhost|local)$/.test(host) ||
    /^(127|10)\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host === '::1' ||
    /^f[cd]/i.test(host)
  );
}
