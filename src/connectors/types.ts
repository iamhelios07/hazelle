import type { Carries, ModelSettings, Takes } from './settings';

export type Protocol = 'chat-completions' | 'anthropic-messages';

// A request that cannot be built, refused before any network call. The code names the reason; the UI words it.
export class ConnectorError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export type Endpoint = { baseUrl: string; protocol: Protocol };

// A built-in connection type fixes the endpoint, so baseUrl and protocol are set only on a generic connection.
// Starred models are kept as catalog snapshots, so pickers and requests need no catalog fetch first.
export type Connection = {
  type: string;
  label: string;
  // The account a sign-in connection (Copilot) was made with, shown only on 연결; the label stays the type's own.
  account?: string;
  baseUrl: string | null;
  protocol: Protocol | null;
  secret: string;
  starred: Starred[];
};

export type HttpRequest = { url: string; method: 'GET' | 'POST'; headers: Record<string, string>; body: string | null };

export type Modality = 'text' | 'image' | 'audio' | 'video' | 'file';

// null means the catalog does not say. It is shown as unknown, never as "no".
export type Model = {
  id: string;
  name: string;
  input: Modality[] | null;
  output: Modality[] | null;
  contextLength: number | null;
  maxOutput: number | null;
  reasoning: boolean | null;
  tools: boolean | null;
  // The wire format this model is called with, for a connection that serves models in more than one
  // (Copilot). null means the connection's own. 'unsupported' means only formats this app does not
  // speak yet, so a request is refused before sending.
  protocol: Protocol | 'unsupported' | null;
  // Absent where the catalog says nothing about request settings (the generic list), and from a
  // snapshot starred before catalogs were read for them.
  takes?: Takes;
};

// profile: the 설정 묶음 it uses; without one, the default 묶음.
export type Starred = Model & { profile?: string };

// cache: the prompt up to and including this message is a cache point. Only a request whose model settings turn
// caching on sends it, and a codec never puts the field itself on the wire.
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string; cache?: true };
export type ChatRequest = { model: Model; messages: ChatMessage[]; settings: ModelSettings };

// A missing count stays null. Filling it with 0 would read as a measured zero and shrink totals.
export type Usage = {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
};

// reported: the provider said what the reply cost. price-list: worked out from a price table the app
// carries, which can fall behind the provider's, so it is shown as an estimate.
export type Cost = { unit: 'usd' | 'credit'; amount: number; source: 'reported' | 'price-list' };

// One figure a provider reports about a credential's spending. Units are never summed together.
export type Meter =
  | { kind: 'left'; label: string; unit: MeterUnit; amount: number; limit: number | null; resets: MeterReset | null }
  | { kind: 'spent'; label: string; unit: MeterUnit; amount: number };

export type MeterUnit = 'usd' | 'credit' | 'requests';
// A period, or the moment of the next reset when the provider names one.
export type MeterReset = 'daily' | 'weekly' | 'monthly' | { at: number };

export type Phase = 'text' | 'reasoning';

// id is the provider's id for the reply, when its events carry one.
export type StreamFacts = { rawUsage: Record<string, unknown>; finishReason: string | null; id: string | null };

export type Terminal = { state: 'completed' } | { state: 'failed'; error: string };

// A connection type never re-implements a wire format; it adds to one through its own hooks.
export type Codec = {
  // How a plain API key is presented. A connection type may present its credential its own way.
  authHeaders(secret: string): Record<string, string>;
  // Requests are built without the credential, which is added last, so a request that cannot be built is refused
  // before a credential is fetched.
  listModels(endpoint: Endpoint): HttpRequest;
  // null when the payload is not a model list at all, which is not the same as an empty one.
  parseModels(payload: unknown): Model[] | null;
  carries: Carries;
  // The wire sends every system message ahead of the others (Messages' system field), so a provider's cache reads them
  // first, whatever their place in the prompt.
  systemFirst: boolean;
  // fields are the connection type's own, laid over the format's body.
  chat(endpoint: Endpoint, request: ChatRequest, fields: Record<string, unknown>): HttpRequest;
  read(event: unknown, facts: StreamFacts, append: (phase: Phase, text: string) => void): void;
  terminal(event: unknown): Terminal | null;
  truncated(finishReason: string): boolean;
  usage(raw: Record<string, unknown>): Usage;
};

// Every hook is optional: without one, the codec's default answers, exactly as for a connection described by hand.
export type ConnectionType = {
  id: string;
  label: string;
  // Where it sits in the 연결 추가 list, and the line under its name there.
  group: 'gateway' | 'maker' | 'subscription';
  description: string;
  keyPage?: string;
  // Where the model list is, and how a model that names no protocol of its own is called.
  endpoint: Endpoint;
  // The base address of each other protocol its models may name.
  routes?: Partial<Record<Protocol, string>>;
  // Absent for a type the user connects by signing in: there is no key to paste.
  detect?: { key: RegExp | null; host: string };
  signIn?: SignIn;
  // Trades the stored credential for the short-lived one that requests carry.
  exchange?: { request(secret: string): HttpRequest; parse(payload: unknown): Token | null };
  headers?: (credential: string) => Record<string, string>;
  parseModels?: (payload: unknown) => Model[] | null;
  // Reasoning by a token budget, in a field of the provider's own where its codec has none. Its
  // parseModels says which models take one.
  reasoningBudget?: (tokens: number) => Record<string, unknown>;
  // Its chat-completions endpoint reads cache_control on a message's content (OpenRouter). Models that cache by
  // cache points use it; the provider is left to say whether the others ignore it, so it stays unknown per model.
  cacheControl?: true;
  // usage is the codec's reading of the stream's counts, for a type that prices tokens itself.
  cost?: (reply: { facts: StreamFacts; usage: Usage | null; model: Model }) => Cost | null;
  // Asked with the stored credential. It is also the check that a pasted key works, where the model
  // list is public (OpenRouter's is).
  meters?: { request(secret: string): HttpRequest; parse(payload: unknown): Meter[] | null };
  // A cost the provider books only after the reply, looked up by the reply's id. Until it is booked
  // the lookup answers 404.
  settle?: { request(secret: string, id: string): HttpRequest; parse(payload: unknown): Cost | null };
};

export type Token = { value: string; expiresAt: number };

// OAuth device authorization (RFC 8628): the user enters a short code on the provider's own site, and
// the token that comes back is the connection's secret. account names who signed in, so two
// connections of one type can be told apart.
export type SignIn = {
  site: string;
  codeUrl: string;
  tokenUrl: string;
  clientId: string;
  scope: string;
  headers: Record<string, string>;
  account: { request(secret: string): HttpRequest; parse(payload: unknown): string | null };
};
