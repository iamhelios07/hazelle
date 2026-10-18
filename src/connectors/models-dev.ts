// Prices come from models.dev's database, never from a table typed in here or a pricing page read (user, 2026-10-04).
// The server reads this module too (eslint/boundaries.js), so it stays data and types only.

// models.dev's provider id for each connection type it lists; a type left out costs 알 수 없음 unless its provider
// reports the cost or its model list states prices, and its models take and give only what their list says. credit:
// the provider bills in AI credits of $0.01 (Copilot), so a cost worked out from the list is shown in credits.
export const MODELS_DEV_LISTS: Readonly<Partial<Record<string, { list: string; credit?: true }>>> = {
  openrouter: { list: 'openrouter' },
  vercel: { list: 'vercel' },
  ollama: { list: 'ollama-cloud' },
  perplexity: { list: 'perplexity' },
  groq: { list: 'groq' },
  together: { list: 'togetherai' },
  cerebras: { list: 'cerebras' },
  deepinfra: { list: 'deepinfra' },
  nanogpt: { list: 'nano-gpt' },
  openai: { list: 'openai' },
  anthropic: { list: 'anthropic' },
  google: { list: 'google' },
  vertex: { list: 'google-vertex' },
  xai: { list: 'xai' },
  deepseek: { list: 'deepseek' },
  mistral: { list: 'mistral' },
  moonshot: { list: 'moonshotai' },
  upstage: { list: 'upstage' },
  friendli: { list: 'friendli' },
  chutes: { list: 'chutes' },
  copilot: { list: 'github-copilot', credit: true },
};

// The models a connection type lists itself, by id and name: no models.dev list holds them. Kept here so the server names
// them on 헤이젤 지금 (server/pulse) from the connector's own list. The first is the type's default.
export const CONNECTOR_MODELS = {
  novelai: [
    { id: 'nai-diffusion-5-full', name: 'NovelAI Diffusion V5 Full' },
    { id: 'nai-diffusion-5-curated', name: 'NovelAI Diffusion V5 Curated' },
    { id: 'nai-diffusion-4-5-full', name: 'NovelAI Diffusion V4.5 Full' },
    { id: 'nai-diffusion-4-5-curated', name: 'NovelAI Diffusion V4.5 Curated' },
  ],
  voyage: ['voyage-4-lite', 'voyage-4', 'voyage-4-large'].map((id) => ({ id, name: id })),
} as const satisfies Record<string, readonly { id: string; name: string }[]>;

// models.dev's words for what a model takes and gives, as the app's Modality names them; any other word is dropped.
export const MODELS_DEV_MODALITIES = { text: 'text', image: 'image', audio: 'audio', video: 'video', pdf: 'file' } as const;
export type ListedModality = (typeof MODELS_DEV_MODALITIES)[keyof typeof MODELS_DEV_MODALITIES];

// A tier's rates replace the base ones once the request's input tokens exceed above. Tiers ascend by above.
export type PriceTier = { above: number; input: number; output: number; cacheRead: number | null; cacheWrite: number | null };

// USD per million tokens. A null cache rate is one the list does not state.
export type Rates = { input: number; output: number; cacheRead: number | null; cacheWrite: number | null; tiers: PriceTier[] };

// price: null where models.dev cannot price the model whole. input, output: null where it does not say.
export type ListedModel = { price: Rates | null; input: ListedModality[] | null; output: ListedModality[] | null };

// GET /api/models-dev?provider=<list>. fetchedAt is null, and models empty, until the server's first fetch has landed.
export type ModelsDevList = { fetchedAt: number | null; models: Record<string, ListedModel> };
