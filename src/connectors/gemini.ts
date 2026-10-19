import { failedTerminal } from './errors';
import type { Reasoning } from './settings';
import { bareModel, embedUsage } from './chat-completions';
import type { ChatMessage, Codec, EmbedPurpose, InputPicture, Model, Phase, StreamFacts, Terminal } from './types';
import { pdfMessage, planPdf } from './gemini-pdf';
import { count, isRecord, list, vector } from './values';

// The Gemini API (generateContent), checked against ai.google.dev/api on 2026-10-04.

const LEVELS = ['minimal', 'low', 'medium', 'high'];

// Gemini 3 takes thinkingLevel and Gemini 2.5 thinkingBudget, where 0 is off and -1 dynamic; Gemini 3.1 Pro cannot
// turn thinking off and refuses 0. Thoughts come back only with includeThoughts, which a model that does not think may
// refuse, so with no reasoning setting it is asked only of models the catalog says think.
function thinkingConfig(reasoning: Reasoning | undefined, model: Model) {
  switch (reasoning?.kind) {
    case undefined:
      return model.reasoning ? { thinkingConfig: { includeThoughts: true } } : {};
    case 'off':
      return { thinkingConfig: { thinkingBudget: 0 } };
    case 'budget':
      return { thinkingConfig: { thinkingBudget: reasoning.tokens, includeThoughts: true } };
    case 'level':
      return { thinkingConfig: { thinkingLevel: reasoning.level, includeThoughts: true } };
    case 'adaptive':
      return { thinkingConfig: { ...(reasoning.level === null ? { thinkingBudget: -1 } : { thinkingLevel: reasoning.level }), includeThoughts: true } };
  }
}

type Part = { text: string } | { inlineData: { mimeType: string; data: string }; mediaResolution?: { level: 'MEDIA_RESOLUTION_LOW' } };

// Only PDF로 보내기 sends a PDF. Its page's picture is what bills, and its text layer reads the same at the lowest
// resolution; set on the part, so the pictures beside it keep theirs.
const media = ({ type, data }: InputPicture): Part => ({ inlineData: { mimeType: type, data }, ...(type === 'application/pdf' && { mediaResolution: { level: 'MEDIA_RESOLUTION_LOW' } }) });

const parts = ({ content, pictures = [] }: ChatMessage): Part[] => [...pictures.map(media), { text: content }];

function contents(messages: ChatMessage[]) {
  const turns: { role: 'user' | 'model'; parts: Part[] }[] = [];
  for (const message of messages) {
    const role = message.role === 'assistant' ? 'model' : 'user';
    const last = turns.at(-1);
    if (last?.role === role) last.parts.push(...parts(message));
    else turns.push({ role, parts: parts(message) });
  }
  return turns;
}

// STOP and MAX_TOKENS end a reply that stands; every other reason, and a blocked prompt, is the provider refusing it.
const STANDING = new Set(['STOP', 'MAX_TOKENS']);

function refusal(event: Record<string, unknown>): string | null {
  const feedback = isRecord(event.promptFeedback) ? event.promptFeedback : {};
  if (typeof feedback.blockReason === 'string') return feedback.blockReason;
  const [candidate] = list(event.candidates);
  if (!isRecord(candidate) || typeof candidate.finishReason !== 'string' || STANDING.has(candidate.finishReason)) return null;
  return typeof candidate.finishMessage === 'string' && candidate.finishMessage ? `${candidate.finishReason}: ${candidate.finishMessage}` : candidate.finishReason;
}

function read(event: unknown, facts: StreamFacts, append: (phase: Phase, text: string) => void) {
  if (!isRecord(event)) return;
  if (typeof event.responseId === 'string' && event.responseId) facts.id ??= event.responseId;
  const [candidate] = list(event.candidates);
  if (isRecord(candidate)) {
    const content = isRecord(candidate.content) ? candidate.content : {};
    for (const part of list(content.parts)) {
      if (isRecord(part) && typeof part.text === 'string') append(part.thought === true ? 'reasoning' : 'text', part.text);
    }
    if (typeof candidate.finishReason === 'string') facts.finishReason = candidate.finishReason;
  }
  if (isRecord(event.usageMetadata)) {
    Object.assign(facts.rawUsage, event.usageMetadata);
    if (typeof event.usageMetadata.trafficType === 'string') facts.tier = event.usageMetadata.trafficType;
  }
}

// The stream has no end marker: it closes after the chunk that names finishReason.
function terminal(event: unknown): Terminal | null {
  if (!isRecord(event)) return null;
  if (event.error !== undefined && event.error !== null) return failedTerminal(event.error);
  const refused = refusal(event);
  return refused === null ? null : { state: 'failed', error: refused };
}

const TASKS: Record<EmbedPurpose, string> = { query: 'RETRIEVAL_QUERY', document: 'RETRIEVAL_DOCUMENT' };

export const gemini: Codec = {
  authHeaders: (secret) => ({ 'x-goog-api-key': secret }),

  // 1000 is the most one page holds; a later page (nextPageToken) is not asked for.
  listModels: (endpoint) => ({ url: `${endpoint.baseUrl}/models?pageSize=1000`, method: 'GET', headers: {}, body: null }),

  systemFirst: true,

  // Google's JSON leaves out a field at its default, so a model without thinking has no thinking key: absent is false.
  // The list says nothing about input modalities, tools, or which request settings or thinking controls a model takes;
  // its methods tell an embedding model from one that writes.
  parseModels(payload) {
    if (!isRecord(payload) || !Array.isArray(payload.models)) return null;
    return payload.models.flatMap((raw): Model[] => {
      if (!isRecord(raw) || typeof raw.name !== 'string' || !raw.name.startsWith('models/')) return [];
      const methods = list(raw.supportedGenerationMethods);
      const chats = methods.includes('generateContent');
      const embeds = !chats && methods.includes('embedContent');
      if (!chats && !embeds) return [];
      const id = raw.name.slice('models/'.length);
      return [
        {
          ...bareModel(id),
          name: typeof raw.displayName === 'string' && raw.displayName ? raw.displayName : id,
          output: embeds ? ['embedding'] : null,
          contextLength: count(raw.inputTokenLimit) || null,
          maxOutput: count(raw.outputTokenLimit) || null,
          reasoning: raw.thinking === true,
        },
      ];
    });
  },

  carries: {
    numbers: {
      maxOutput: { min: 1, max: null },
      temperature: { min: 0, max: 2 },
      topP: { min: 0, max: 1 },
      topK: { min: 0, max: null },
      frequencyPenalty: { min: null, max: null },
      presencePenalty: { min: null, max: null },
      seed: { min: null, max: null },
    },
    reasoning: { off: true, levels: LEVELS, budget: { min: null, max: null }, adaptive: true },
    stop: true,
    verbosity: false,
    serviceTier: false,
    pdf: true,
  },

  // Gemini caches on its own (implicit caching) or by a separately created cachedContent; it has no cache points.
  cache: null,

  chat(endpoint, { model, messages: asked, settings }, fields) {
    const plan = settings.pdf ? planPdf(asked, settings.pdf) : null;
    const messages = plan ? [...plan.lead, pdfMessage(plan), ...plan.tail] : asked;
    const system = messages.filter((message) => message.role === 'system');
    const config = {
      ...(settings.maxOutput === undefined ? {} : { maxOutputTokens: settings.maxOutput }),
      ...(settings.temperature === undefined ? {} : { temperature: settings.temperature }),
      ...(settings.topP === undefined ? {} : { topP: settings.topP }),
      ...(settings.topK === undefined ? {} : { topK: settings.topK }),
      ...(settings.frequencyPenalty === undefined ? {} : { frequencyPenalty: settings.frequencyPenalty }),
      ...(settings.presencePenalty === undefined ? {} : { presencePenalty: settings.presencePenalty }),
      ...(settings.seed === undefined ? {} : { seed: settings.seed }),
      ...(settings.stop === undefined ? {} : { stopSequences: settings.stop }),
      ...thinkingConfig(settings.reasoning, model),
    };
    const method = settings.streaming === false ? 'generateContent' : 'streamGenerateContent?alt=sse';
    return {
      url: `${endpoint.baseUrl}/models/${model.id}:${method}`,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(system.length ? { systemInstruction: { parts: [{ text: system.map((message) => message.content).join('\n\n') }] } } : {}),
        contents: contents(messages.filter((message) => message.role !== 'system')),
        ...(Object.keys(config).length ? { generationConfig: config } : {}),
        ...fields,
      }),
    };
  },

  read,

  terminal,

  whole(payload, facts, append) {
    if (!isRecord(payload)) return null;
    const failed = terminal(payload);
    if (failed) return failed;
    if (!Array.isArray(payload.candidates)) return null;
    read(payload, facts, append);
    return { state: 'completed' };
  },

  truncated: (finishReason) => finishReason === 'MAX_TOKENS',

  // promptTokenCount already holds the cached part. candidatesTokenCount leaves thoughts out, and a count at zero is
  // left out of the JSON, so a missing thoughts count adds nothing.
  usage(raw) {
    const candidates = count(raw.candidatesTokenCount);
    const thoughts = count(raw.thoughtsTokenCount);
    return {
      inputTokens: count(raw.promptTokenCount),
      cachedInputTokens: count(raw.cachedContentTokenCount),
      cacheWriteInputTokens: null,
      outputTokens: candidates === null && thoughts === null ? null : (candidates ?? 0) + (thoughts ?? 0),
      reasoningTokens: thoughts,
    };
  },
  embeds: {
    request: (endpoint, model, texts, as, fields) => ({
      url: `${endpoint.baseUrl}/models/${model.id}:batchEmbedContents`,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requests: texts.map((text) => ({ model: `models/${model.id}`, content: { parts: [{ text }] }, ...(as && { embedContentConfig: { taskType: TASKS[as] } }) })),
        ...fields,
      }),
    }),
    parse(payload, expected) {
      if (!isRecord(payload) || !Array.isArray(payload.embeddings) || payload.embeddings.length !== expected) return null;
      const vectors = payload.embeddings.map((embedding) => (isRecord(embedding) && vector(embedding.values) ? embedding.values : null));
      if (vectors.some((values) => values === null)) return null;
      const usage = isRecord(payload.usageMetadata) ? payload.usageMetadata : {};
      return { vectors: vectors as number[][], usage: embedUsage(count(usage.promptTokenCount)), raw: usage };
    },
  },
};
