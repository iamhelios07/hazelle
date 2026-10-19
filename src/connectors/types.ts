import type { Rates } from './models-dev';
import type { Accepts, Carries, ModelSettings, Pdf, Takes } from './settings';

export type Protocol = 'chat-completions' | 'anthropic-messages' | 'gemini' | 'responses';

// Refused before any network call. The code names the reason; the UI words it.
export class ConnectorError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export type Endpoint = { baseUrl: string; protocol: Protocol };

// A built-in connection type fixes the endpoint, so baseUrl and protocol are set only on a generic connection.
// Starred models are kept as catalog snapshots, so pickers and requests need no catalog fetch first.
// accounts holds exactly one account and turns is null, unless the type is a pool; a pool always has turns.
// retries: how many times a try that failed for a moment is sent again (runtime/connections retriesOf), absent to follow
// the account's shared count; 0 sends each call once. A model's 설정 묶음 can override it in turn.
export type Connection = {
  type: string;
  label: string;
  baseUrl: string | null;
  protocol: Protocol | null;
  accounts: Account[];
  turns: Turns | null;
  starred: Starred[];
  retries?: number;
};

// name: who signed in, shown only on 연결; the label stays the type's own. A pasted key names no one.
export type Account = { id: string; secret: string; name?: string };

// Groups take turns by the month, switching on day (1–28) in local time; their order is the turn order, and the
// accounts in a group are in pick order. Every account is in exactly one group. anchor: the group whose turn cycle
// (model/turns cycleOf) was.
export type Turns = { day: number; groups: Group[]; anchor: { group: string; cycle: number } };
export type Group = { id: string; name: string; accounts: string[] };

export type HttpRequest = { url: string; method: 'GET' | 'POST'; headers: Record<string, string>; body: string | null };

export type Modality = 'text' | 'image' | 'audio' | 'video' | 'file' | 'embedding';

// null means neither the catalog nor models.dev says. It is shown as unknown, never as "no".
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
  price?: Rates;
  // The maker as the provider's model list names it (Copilot's vendor); absent where the list names none.
  vendor?: string;
};

// profile: the 설정 묶음 it uses; without one, the default 묶음.
export type Starred = Model & { profile?: string };

// cache: the prompt up to and including this message is a cache point. Only a request whose model settings turn
// caching on sends it, and a codec never puts the field itself on the wire.
// pictures: shown to the model with a user message's text, each codec in its own wire shape. Sent only to a model that
// sees pictures (seesPictures); a request carrying them to any other is refused before sending.
// document: words the codec sends as a file of its own (Codec.pack), ahead of the pictures; set only by its pack.
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string; cache?: true; document?: string; pictures?: InputPicture[] };
// type: the media type; data: the bytes as base64.
export type InputPicture = { type: string; data: string };
// A model whose catalog does not say takes no picture: an unknown is never sent one.
export const seesPictures = (model: Pick<Model, 'input'>) => model.input?.includes('image') === true;
export const carriesPictures = (message: ChatMessage) => (message.pictures?.length ?? 0) > 0;
export type ChatRequest = { model: Model; messages: ChatMessage[]; settings: ModelSettings };

// A missing count stays null. Filling it with 0 would read as a measured zero and shrink totals.
export type Usage = {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
};

// reported: the provider said what the reply cost. price-list: worked out from the model's price, which can fall behind
// the provider's, so it is shown as an estimate.
export type Cost = { unit: 'usd' | 'credit'; amount: number; source: 'reported' | 'price-list' };

// Units are never summed together.
export type Meter =
  | { kind: 'left'; label: string; unit: MeterUnit; amount: number; limit: number | null; resets: MeterReset | null }
  | { kind: 'spent'; label: string; unit: MeterUnit; amount: number };

// concurrency: units a provider's plan lets requests hold at once (Featherless), not a count of requests. percent: a
// share of an allowance the provider states only as a share (NovelAI's usage limit), out of a limit of 100.
export type MeterUnit = 'usd' | 'credit' | 'requests' | 'tokens' | 'concurrency' | 'percent';
export type MeterReset = 'daily' | 'weekly' | 'monthly' | { at: number };

// plan: the subscription the same answer names, shown beside the account; null where it names none.
export type MeterRequest = { request(secret: string): HttpRequest; parse(payload: unknown): Meter[] | null; plan?(payload: unknown): string | null };

export type Phase = 'text' | 'reasoning';

// tier: the service tier the reply says served it; null where it names none.
export type StreamFacts = { rawUsage: Record<string, unknown>; finishReason: string | null; id: string | null; tier: string | null };

export type Terminal = { state: 'completed' } | { state: 'failed'; error: string; code?: string };

// How a cache point reaches the wire: cache_control on the message's text (Anthropic's shape, which OpenRouter also
// reads in chat completions), a field of the provider's own on the message, or one prompt_cache_key for the cached
// prefix, which marks no point at all (OpenAI's prefix caching).
export type CacheMark = { kind: 'part' } | { kind: 'message'; field: string } | { kind: 'key' };
// accepted null: whether the model reads it is not known; it is sent all the same.
export type CacheWay = { mark: CacheMark; accepted: Accepts };

// A connection type never re-implements a wire format; it adds to one through its own hooks.
export type Codec = {
  authHeaders(secret: string): Record<string, string>;
  // Requests are built without the credential, which is added last, so a request that cannot be built is refused
  // before a credential is fetched.
  listModels(endpoint: Endpoint): HttpRequest;
  // null when the payload is not a model list at all, which is not the same as an empty one.
  parseModels(payload: unknown): Model[] | null;
  carries: Omit<Carries, 'cache' | 'discount' | 'pdf'>;
  // null for a format with no cache mark of its own; a connection type may state one (ConnectionType cachePoints).
  cache: CacheWay | null;
  // The wire sends every system message ahead of the others (Messages' system field), so a provider's cache reads them
  // first, whatever their place in the prompt.
  systemFirst: boolean;
  // fields are the connection type's own, laid over the format's body. mark: how the route writes a cache point.
  // PDF로 보내기, where the format has it: rewrites the messages sending() hands chat, after its cache points.
  pack?(messages: ChatMessage[], pdf: Pdf): ChatMessage[];
  chat(endpoint: Endpoint, request: ChatRequest, fields: Record<string, unknown>, mark: CacheMark | null): HttpRequest;
  read(event: unknown, facts: StreamFacts, append: (phase: Phase, text: string) => void): void;
  terminal(event: unknown): Terminal | null;
  // null when the payload is not this format's reply at all.
  whole(payload: unknown, facts: StreamFacts, append: (phase: Phase, text: string) => void): Terminal | null;
  truncated(finishReason: string): boolean;
  usage(raw: Record<string, unknown>): Usage;
  // null for a format with no embeddings.
  embeds: Embeds | null;
};

export type EmbedPurpose = 'query' | 'document';

// Built from the format; whether a connection type serves it is the type's (ConnectionType embeds). as: what the texts
// are for, which retrieval-tuned models embed differently; a format with no such field drops it, and fields, the
// connection type's own (ConnectionType embedPurpose), are laid over the body. parse answers null for a body that is not
// this format's embedding answer, else a vector per text, in order; raw is the usage as sent, which a type's cost reads.
export type Embeds = {
  request(endpoint: Endpoint, model: Model, texts: string[], as: EmbedPurpose | null, fields: Record<string, unknown>): HttpRequest;
  parse(payload: unknown, count: number): { vectors: number[][]; usage: Usage; raw: Record<string, unknown> } | null;
};

// Every hook is optional: without one, the codec's default answers, exactly as for a connection described by hand.
// models: the type's whole list, for a provider with none to fetch (Voyage AI). A type that speaks no chat format has no
// endpoint, and its models only draw. endpointFor: an endpoint the account's own key names (Vertex AI's project), read
// from the secret of a type that is no pool; null for a secret that is not such a key.
export type ConnectionType = TypeHooks &
  (
    | { endpoint: Endpoint; endpointFor?: never; models?: Model[] }
    | { endpoint?: never; endpointFor: (secret: string) => Endpoint | null; models?: never }
    | { endpoint?: never; endpointFor?: never; models: Model[] }
  );

export type KeyParts = {
  label: string;
  fields: { id: string; label: string; lines?: number; placeholder: string; help?: string }[];
  join: (values: Record<string, string>) => string;
};

type TypeHooks = {
  id: string;
  label: string;
  group: 'gateway' | 'maker' | 'subscription';
  // Listed again under 주요 on 연결 추가, ahead of the groups (user, 2026-10-04).
  major?: true;
  description: string;
  keyPage?: string;
  // The secret where it is no one-line API key: its name on 연결, how many lines its field takes, and the files it can
  // be read from (an input accept list). parts: the same secret typed as separate values, which some tools hand out
  // one by one, folded under its label; join makes the secret of them, '' while one it needs is missing.
  keyForm?: { label: string; lines: number; placeholder: string; accept: string; parts?: KeyParts };
  routes?: Partial<Record<Protocol, string>>;
  // Absent for a type the user connects by signing in: there is no key to paste.
  detect?: { key: RegExp | null; host: string };
  signIn?: SignIn;
  // One connection may hold several signed-in accounts; the core picks one per reply, by its group's turn and by the
  // allowance its meters leave.
  pool?: true;
  exchange?: { request(secret: string): Promise<HttpRequest>; parse(payload: unknown): Token | null };
  headers?: (credential: string) => Record<string, string>;
  // The model list at an address of the provider's own, in place of the codec's (Vertex AI lists models outside a project).
  listModels?: (endpoint: Endpoint) => HttpRequest;
  parseModels?: (payload: unknown) => Model[] | null;
  // Reasoning by a token budget, in a field of the provider's own where its codec has none. Its
  // parseModels says which models take one.
  reasoningBudget?: (tokens: number) => Record<string, unknown>;
  // The output limit in a field of the provider's own, sent in place of the codec's (OpenAI's reasoning models refuse
  // max_tokens).
  outputLimit?: (tokens: number) => Record<string, unknown>;
  // Laid over the headers of a chat request that carries pictures, and only of one: Copilot's vision flag.
  pictureHeaders?: Record<string, string>;
  // How its endpoint takes a cache point, per model, where the format has no mark of its own (chat completions).
  cachePoints?: (model: Model) => CacheWay;
  cost?: (reply: { facts: StreamFacts; usage: Usage | null; model: Model }) => Cost | null;
  // 할인 받기: the lane a 설정 묶음's discount switch takes; without one the switch is not offered. No pool type has one,
  // so a batch waited for after a reload is asked about with the connection's one account.
  discount?: Discount;
  // Asked with the stored credential, all at once. They are also the check that a pasted key works, where the model
  // list is public (OpenRouter's is): a key every one of them refuses is not saved.
  meters?: MeterRequest[];
  // The provider's own usage page, linked beside the figures, or alone where it reports none (Ollama Cloud).
  usagePage?: string;
  // A cost the provider books only after the reply, looked up by the reply's id. Until it is booked
  // the lookup answers 404.
  settle?: { request(secret: string, id: string): HttpRequest; parse(payload: unknown): Cost | null };
  draws?: Draws;
  // null: the type serves no embeddings, or its codec's embeddings were not verified against it (design §4,
  // docs research/embeddings-spike.md).
  embeds?: null;
  // An embedding call's purpose in a field of the provider's own, where its format has none (Voyage's input_type).
  embedPurpose?: (as: EmbedPurpose | null) => Record<string, unknown>;
};

// Half price for a slower answer (design §6.7). rates: what each of the model's price rates is multiplied by once the
// lane served the call, never because it was asked for. accepted: whether the model takes the lane; null where its
// catalog does not say. tier: the same call at a slower service tier, asked for with fields laid over the body, headers
// laid over the request's, or both; the reply's reported tier (StreamFacts tier) equal to served is what says the lane
// served it; busy, whether a refusal (its status and the provider's code, where it names one) is the lane having no
// room for the call now, which the same call off the lane would not meet. batch: the whole reply submitted as a batch of
// one and waited for; an answer read from the batch is one the lane served.
export type Discount = { rates: DiscountRates; accepted: Accepts } & ({ lane: 'tier'; fields?: Record<string, unknown>; headers?: Record<string, string>; served: string; busy: (status: number, code: string | null) => boolean } | { lane: 'batch'; batches: Batches });
export type DiscountRates = Record<'input' | 'output' | 'cacheRead' | 'cacheWrite', number>;

// Every request is built without the credential, which is added last (registry withCredential), as for a chat. key: the
// request's own name in the batch, which its answer is found by. submit takes the codec's request for the whole reply
// (asked for unstreamed). submitted and ended answer null for a payload that is not this lane's batch; answer, for a
// results body that holds no answer for key.
export type Batches = {
  submit(endpoint: Endpoint, model: Model, request: HttpRequest, key: string): HttpRequest;
  submitted(payload: unknown): string | null;
  check(endpoint: Endpoint, batch: string): HttpRequest;
  ended(payload: unknown): boolean | null;
  results(endpoint: Endpoint, batch: string): HttpRequest;
  answer(body: string, key: string): BatchAnswer | null;
  cancel(endpoint: Endpoint, batch: string): HttpRequest;
};

// reply: the codec's whole reply (Codec whole). canceled: stopped before the model answered it; expired: the provider's
// window ran out first. Neither is billed.
export type BatchAnswer = { kind: 'reply'; payload: unknown } | { kind: 'failed'; detail: string } | { kind: 'canceled' } | { kind: 'expired' };

// center: where a character stands, 0–1 from the top left. A model that places no one gets the characters' prompts
// joined into the main one by its connector. steps, scale (prompt guidance), rescale (guidance rescale) and sampler (an
// id of Draws.samplers): null for the model's own, which its connector holds.
export type PictureRequest = {
  model: Model;
  prompt: string;
  negative: string;
  characters: { prompt: string; negative: string; center: { x: number; y: number } }[];
  width: number;
  height: number;
  seed: number;
  steps: number | null;
  scale: number | null;
  rescale: number | null;
  sampler: string | null;
};

export type Picture = { bytes: Uint8Array<ArrayBuffer>; type: string };

// Filled by a connection type whose models draw (Model.output holds 'image'). The request is built without the
// credential, which authHeaders adds last, as for a chat. parse answers null for a body that holds no picture.
export type Draws = {
  // The samplers a request may name, the default first.
  samplers: readonly { id: string; label: string }[];
  request(picture: PictureRequest): HttpRequest;
  authHeaders(secret: string): Record<string, string>;
  parse(body: Uint8Array<ArrayBuffer>, contentType: string | null): Promise<Picture | null>;
  // Whether this picture costs the account nothing right now, asked with the stored credential before each draw. A
  // picture not known to be free waits for the user's press; without this hook every picture is one.
  free?: { request(secret: string): HttpRequest; parse(payload: unknown, picture: PictureRequest): boolean | null };
};

export type Token = { value: string; expiresAt: number };

// OAuth device authorization (RFC 8628): the token that comes back is an account's secret. account names who
// signed in, so two accounts of one type can be told apart.
export type SignIn = {
  site: string;
  codeUrl: string;
  tokenUrl: string;
  clientId: string;
  scope: string;
  headers: Record<string, string>;
  account: { request(secret: string): HttpRequest; parse(payload: unknown): string | null };
};
