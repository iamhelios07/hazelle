export type Protocol = 'chat-completions' | 'anthropic-messages';

// A request that cannot be built, refused before any network call. The code names the reason; the UI words it.
export class ConnectorError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export type Endpoint = { baseUrl: string; protocol: Protocol };

// The stored `connection` object (tech-spec §5). A built-in connection type fixes the endpoint, so
// baseUrl and protocol are set only on a connection of the generic type. Starred models are kept as
// catalog snapshots, so pickers and requests need no catalog fetch first.
export type Connection = {
  type: string;
  label: string;
  baseUrl: string | null;
  protocol: Protocol | null;
  secret: string;
  starred: Model[];
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
};

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ChatRequest = { model: Model; messages: ChatMessage[]; maxTokens: number | null };

// A missing count stays null. Filling it with 0 would read as a measured zero and shrink totals.
export type Usage = {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
};

export type Cost = { unit: 'usd' | 'credit'; amount: number };

export type Phase = 'text' | 'reasoning';

export type StreamFacts = { rawUsage: Record<string, unknown>; finishReason: string | null };

export type Terminal = { state: 'completed' } | { state: 'failed'; error: string };

// One of the shared wire formats (design §4, Protocol row). A connection type never re-implements
// one; it adds to it through its own hooks.
export type Codec = {
  // How a plain API key is presented. A connection type may present its credential its own way.
  authHeaders(secret: string): Record<string, string>;
  // Requests are built without the credential, which is added last (registry withCredential), so a
  // request that cannot be built is refused before a credential is fetched.
  listModels(endpoint: Endpoint): HttpRequest;
  // null when the payload is not a model list at all, which is not the same as an empty one.
  parseModels(payload: unknown): Model[] | null;
  chat(endpoint: Endpoint, request: ChatRequest): HttpRequest;
  // Reads one decoded SSE event. Text goes through append; usage and the finish reason go to facts.
  read(event: unknown, facts: StreamFacts, append: (phase: Phase, text: string) => void): void;
  terminal(event: unknown): Terminal | null;
  // Whether a finish reason means the output hit its token limit.
  truncated(finishReason: string): boolean;
  usage(raw: Record<string, unknown>): Usage;
};

// A built-in provider laid over the generic connection (design §4). Every hook is optional: without
// one, the codec's default answers, exactly as for a connection the user described by hand.
export type ConnectionType = {
  id: string;
  label: string;
  // Where it sits in the 연결 추가 list, and the line under its name there.
  group: 'gateway' | 'maker' | 'subscription';
  description: string;
  // The provider's page for making an API key, linked from the key screen.
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
  // Presents the credential with the provider's own headers, in place of the codec's.
  headers?: (credential: string) => Record<string, string>;
  parseModels?: (payload: unknown) => Model[] | null;
  cost?: (facts: StreamFacts) => Cost | null;
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
