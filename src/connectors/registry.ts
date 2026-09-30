import { anthropic } from './anthropic';
import { anthropicMessages } from './anthropic-messages';
import { chatCompletions } from './chat-completions';
import { copilot } from './copilot';
import { ollama } from './ollama';
import { openRouter } from './openrouter';
import { fit, settingsSchema, type Carries, type SettingsSchema } from './settings';
import { vercel } from './vercel';
import { ConnectorError, type ChatMessage, type ChatRequest, type Codec, type Connection, type ConnectionType, type Endpoint, type HttpRequest, type Model } from './types';

// Adding a provider means adding its connection type here. Nothing else names one.
export const CONNECTION_TYPES: readonly ConnectionType[] = [openRouter, vercel, ollama, anthropic, copilot];

// The type of a connection the user described by address and protocol.
export const GENERIC = 'generic';

// Keyed by any string: a stored connection or model snapshot may name a protocol that only a newer
// version of the app speaks.
const CODECS: Partial<Record<string, Codec>> = { 'chat-completions': chatCompletions, 'anthropic-messages': anthropicMessages };

export type Resolved = { type: ConnectionType | null; endpoint: Endpoint; codec: Codec };

// null for a type this version does not know, such as one saved by a newer version of the app.
export function resolveConnection(connection: Connection): Resolved | null {
  if (connection.type === GENERIC) {
    // An address saved before its provider joined the list is that provider now.
    const claimed = connection.baseUrl && URL.canParse(connection.baseUrl) ? typeForHost(new URL(connection.baseUrl).hostname) : undefined;
    if (claimed) return { type: claimed, endpoint: claimed.endpoint, codec: CODECS[claimed.endpoint.protocol]! };
    const codec = connection.protocol && CODECS[connection.protocol];
    if (!connection.baseUrl || !connection.protocol || !codec) return null;
    return { type: null, endpoint: { baseUrl: connection.baseUrl, protocol: connection.protocol }, codec };
  }
  const type = CONNECTION_TYPES.find((candidate) => candidate.id === connection.type);
  return type ? { type, endpoint: type.endpoint, codec: CODECS[type.endpoint.protocol]! } : null;
}

const typeForHost = (hostname: string) => CONNECTION_TYPES.find((type) => type.detect?.host === hostname);

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

// What one model's requests can carry: its codec's, and a reasoning budget and cache points its connection type adds.
function carries({ type, codec }: Resolved): Carries {
  const { reasoning, cache } = codec.carries;
  return {
    ...codec.carries,
    reasoning: reasoning.budget || !type?.reasoningBudget ? reasoning : { ...reasoning, budget: { min: null, max: null } },
    cache: cache === false && type?.cacheControl ? null : cache,
  };
}

// null for a model this version cannot call at all.
export function modelSettings(connection: Connection, model: Model): SettingsSchema | null {
  const resolved = resolveConnection(connection);
  if (!resolved) return null;
  try {
    return settingsSchema(carries(resolveModel(resolved, model)), model);
  } catch (error) {
    if (error instanceof ConnectorError) return null;
    throw error;
  }
}

// settings is the 묶음's as stored; the 모델 설정 screen names each change with the same fit().
export function chatRequest(route: Resolved, { model, messages, settings: stored }: ChatRequest): HttpRequest {
  const { settings } = fit(settingsSchema(carries(route), model), stored);
  const { reasoning } = settings;
  const fields = reasoning?.kind === 'budget' && !route.codec.carries.reasoning.budget && route.type?.reasoningBudget ? route.type.reasoningBudget(reasoning.tokens) : {};
  const roled = settings.systemAsUser ? messages.map((message) => (message.role === 'system' ? { ...message, role: 'user' as const } : message)) : messages;
  return route.codec.chat(route.endpoint, { model, messages: cachePoints(roled, settings.cache !== undefined), settings }, fields);
}

// A request takes at most four cache points (Anthropic's limit, which OpenRouter passes on). Past that the last one
// stays, since the next turn meets it, and so do the first three, whose prefix changes least. None go without caching.
const MAX_POINTS = 4;
function cachePoints(messages: ChatMessage[], caching: boolean): ChatMessage[] {
  const points = messages.flatMap((message, index) => (message.cache ? [index] : []));
  const kept = new Set(caching ? [...points.slice(0, MAX_POINTS - 1), ...points.slice(-1)] : []);
  return messages.map((message, index) => (!message.cache || kept.has(index) ? message : { role: message.role, content: message.content }));
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

// One pasted value, recognized by key shape or host.
export function detect(input: string): Detection | null {
  const text = input.trim();
  if (!text) return null;
  const baseUrl = normalizeBaseUrl(text);
  if (baseUrl) {
    const url = new URL(baseUrl);
    const type = typeForHost(url.hostname);
    if (type) return { kind: 'url', type };
    return { kind: 'generic-url', baseUrl, problem: url.protocol !== 'https:' ? 'not-https' : isLocal(url.hostname) ? 'local' : null };
  }
  if (/\s/.test(text)) return null;
  const type = CONNECTION_TYPES.find((candidate) => candidate.detect?.key?.test(text));
  return type ? { kind: 'key', type, secret: text } : { kind: 'unknown-key', secret: text };
}

export type Search =
  | { kind: 'key'; type: ConnectionType; secret: string }
  | { kind: 'types'; types: readonly ConnectionType[] }
  | { kind: 'address'; baseUrl: string }
  | { kind: 'none' };

// The 연결 추가 list's one field: a pasted key or address is recognized first, because detect reads
// any single word as a key; only then is the text a name to look for. A key never shapes the result
// beyond its type, so it is not echoed back.
export function searchTypes(input: string): Search {
  const text = input.trim();
  if (!text) return { kind: 'types', types: CONNECTION_TYPES };
  const detection = detect(text);
  if (detection?.kind === 'key') return detection;
  if (detection?.kind === 'url') return { kind: 'types', types: [detection.type] };
  if (detection?.kind === 'generic-url') return { kind: 'address', baseUrl: detection.baseUrl };
  const needle = text.toLowerCase();
  const types = CONNECTION_TYPES.filter((type) => `${type.label} ${type.description}`.toLowerCase().includes(needle));
  return types.length ? { kind: 'types', types } : { kind: 'none' };
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

// The hosted relay can never reach these, so the form says so before the first try.
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
