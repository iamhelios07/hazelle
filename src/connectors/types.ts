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
  authHeaders(secret: string): Record<string, string>;
  listModels(endpoint: Endpoint, secret: string): HttpRequest;
  // null when the payload is not a model list at all, which is not the same as an empty one.
  parseModels(payload: unknown): Model[] | null;
  chat(endpoint: Endpoint, secret: string, request: ChatRequest): HttpRequest;
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
  endpoint: Endpoint;
  detect: { key: RegExp | null; host: string };
  parseModels?: (payload: unknown) => Model[] | null;
  cost?: (facts: StreamFacts) => Cost | null;
};
