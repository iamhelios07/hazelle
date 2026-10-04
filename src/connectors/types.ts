import type { Rates } from './price-list';
import type { Carries, ModelSettings, Takes } from './settings';

export type Protocol = 'chat-completions' | 'anthropic-messages' | 'gemini';

// Refused before any network call. The code names the reason; the UI words it.
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
  // Shown only on 연결; the label stays the type's own.
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
  // null means the connection's own. 'unsupported' means only formats this app does not speak yet, so a request is
  // refused before sending.
  protocol: Protocol | 'unsupported' | null;
  // Catalogs that say nothing about request settings keep the Takes fields null.
  takes: Takes;
  // Absent when neither the model list nor models.dev prices it.
  price?: Price;
};

// asOf: when the server fetched the models.dev list it came from; null for a price the provider's own model list
// states, which wins over models.dev's.
export type Price = Rates & { asOf: number | null };

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

// reported: the provider said what the reply cost. price-list: worked out from the model's Price, which can fall behind
// the provider's, so it is shown as an estimate. asOf: the Price's, absent when it has none.
export type Cost = { unit: 'usd' | 'credit'; amount: number } & ({ source: 'reported' } | { source: 'price-list'; asOf?: number });

// Units are never summed together.
export type Meter =
  | { kind: 'left'; label: string; unit: MeterUnit; amount: number; limit: number | null; resets: MeterReset | null }
  | { kind: 'spent'; label: string; unit: MeterUnit; amount: number };

// concurrency: units a provider's plan lets requests hold at once (Featherless), not a count of requests.
export type MeterUnit = 'usd' | 'credit' | 'requests' | 'tokens' | 'concurrency';
export type MeterReset = 'daily' | 'weekly' | 'monthly' | { at: number };

export type MeterRequest = { request(secret: string): HttpRequest; parse(payload: unknown): Meter[] | null };

export type Phase = 'text' | 'reasoning';

export type StreamFacts = { rawUsage: Record<string, unknown>; finishReason: string | null; id: string | null };

export type Terminal = { state: 'completed' } | { state: 'failed'; error: string };

// A connection type never re-implements a wire format; it adds to one through its own hooks.
export type Codec = {
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
  // null when the payload is not this format's reply at all.
  whole(payload: unknown, facts: StreamFacts, append: (phase: Phase, text: string) => void): Terminal | null;
  truncated(finishReason: string): boolean;
  usage(raw: Record<string, unknown>): Usage;
};

// Every hook is optional: without one, the codec's default answers, exactly as for a connection described by hand.
export type ConnectionType = {
  id: string;
  label: string;
  group: 'gateway' | 'maker' | 'subscription';
  // Listed again under 주요 on 연결 추가, ahead of the groups (user, 2026-10-04).
  major?: true;
  description: string;
  keyPage?: string;
  endpoint: Endpoint;
  routes?: Partial<Record<Protocol, string>>;
  // Absent for a type the user connects by signing in: there is no key to paste.
  detect?: { key: RegExp | null; host: string };
  signIn?: SignIn;
  exchange?: { request(secret: string): HttpRequest; parse(payload: unknown): Token | null };
  headers?: (credential: string) => Record<string, string>;
  parseModels?: (payload: unknown) => Model[] | null;
  // Reasoning by a token budget, in a field of the provider's own where its codec has none. Its
  // parseModels says which models take one.
  reasoningBudget?: (tokens: number) => Record<string, unknown>;
  // The output limit in a field of the provider's own, sent in place of the codec's (OpenAI's reasoning models refuse
  // max_tokens).
  outputLimit?: (tokens: number) => Record<string, unknown>;
  // Its chat-completions endpoint reads cache_control on a message's content (OpenRouter). Models that cache by
  // cache points use it; the provider is left to say whether the others ignore it, so it stays unknown per model.
  cacheControl?: true;
  cost?: (reply: { facts: StreamFacts; usage: Usage | null; model: Model }) => Cost | null;
  // Asked with the stored credential, all at once. They are also the check that a pasted key works, where the model
  // list is public (OpenRouter's is): a key every one of them refuses is not saved.
  meters?: MeterRequest[];
  // The provider's own usage page, linked beside the figures, or alone where it reports none (Ollama Cloud).
  usagePage?: string;
  // A cost the provider books only after the reply, looked up by the reply's id. Until it is booked
  // the lookup answers 404.
  settle?: { request(secret: string, id: string): HttpRequest; parse(payload: unknown): Cost | null };
};

export type Token = { value: string; expiresAt: number };

// OAuth device authorization (RFC 8628): the token that comes back is the connection's secret. account names who
// signed in, so two connections of one type can be told apart.
export type SignIn = {
  site: string;
  codeUrl: string;
  tokenUrl: string;
  clientId: string;
  scope: string;
  headers: Record<string, string>;
  account: { request(secret: string): HttpRequest; parse(payload: unknown): string | null };
};
