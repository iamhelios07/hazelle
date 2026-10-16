import { embedAnswer, embedRequest, embedRoute, withCredential } from '../connectors/registry';
import type { EmbedPurpose, Usage } from '../connectors/types';
import type { Receipt } from '../model/chat';
import type { Route } from './assignment';
import type { Credentials } from './credential';
import type { ReplyError } from './generate';
import { relayJson } from './relay';
import type { ObjectStore } from './store';
import { receiptError } from './talk';

export type Embedded = { ok: true; model: string; vectors: number[][] } | { ok: false; reason: 'too-large' | 'flood' | 'failed' };

// Checked before the network, so a tool learns what to split however the provider would have answered.
export const EMBED_TEXTS = 64;
const EMBED_TOKENS = 8192;

// A tokenizer that did not load throws Error('tokenizer').
export const countTexts = (store: Pick<ObjectStore, 'evaluation'>) => async (texts: string[]): Promise<number[]> => {
  const counted = await store.evaluation.count(texts);
  if ('kind' in counted) throw new Error('tokenizer');
  return counted;
};

// One embedding call through the relay, counted in the chat's bot cap (bot: the chat). Consent and the model pick are
// the caller's (Scripts). receipt: null when nothing reached the network.
export async function embedTexts(
  deps: { credentials: Credentials; count(texts: string[]): Promise<number[]> },
  { connection, model }: Route,
  texts: string[],
  as: EmbedPurpose | null,
  bot: string,
  signal?: AbortSignal,
): Promise<{ answer: Embedded; receipt: Receipt | null }> {
  const unsent = (reason: 'too-large' | 'flood' | 'failed') => ({ answer: { ok: false as const, reason }, receipt: null });
  if (texts.length > EMBED_TEXTS) return unsent('too-large');
  if (!texts.length) return { answer: { ok: true, model: model.id, vectors: [] }, receipt: null };
  if ((await deps.count(texts)).some((tokens) => tokens > EMBED_TOKENS)) return unsent('too-large');
  const route = embedRoute(connection.value, model);
  if (!route) return unsent('failed');
  const request = embedRequest(route, model, texts, as);
  const { credentials } = deps;
  const picked = await credentials.pool.pick(connection.value);
  if (!picked.ok) return unsent('failed');
  const credential = await credentials.get(route, picked.account.secret, signal);
  if (!credential.ok) return unsent('failed');
  const began = performance.now();
  const answer = await relayJson(withCredential(route, request, credential.credential), signal, bot);
  const receipt = (made: Pick<Receipt, 'state' | 'cut' | 'error' | 'usage' | 'cost'>): Receipt => ({
    id: crypto.randomUUID(),
    connection: connection.id,
    account: picked.account.id,
    source: connection.value.label,
    model: model.id,
    modelName: model.name,
    finishReason: null,
    replyId: null,
    firstTextMs: null,
    totalMs: Math.round(performance.now() - began),
    cache: null,
    ...made,
  });
  const failed = (error: Exclude<ReplyError, { kind: 'stopped' }>, usage: Usage | null = null) => {
    credentials.pool.stale(connection.value, picked.account);
    return { answer: { ok: false as const, reason: 'failed' as const }, receipt: receipt({ state: 'failed', cut: null, error: receiptError(error), usage, cost: null }) };
  };
  if (!answer.ok) {
    const { failure } = answer;
    // Refused by the server before the provider saw it: the chat's bot calls for this minute are spent.
    if (failure.kind === 'app' && failure.code === 'too-many-bot-calls') return unsent('flood');
    if (failure.kind === 'stopped') return { answer: { ok: false, reason: 'failed' }, receipt: receipt({ state: 'cut', cut: 'stopped', error: null, usage: null, cost: null }) };
    return failed(failure);
  }
  const parsed = embedAnswer(route, model, answer.data, texts.length);
  if (!parsed) return failed({ kind: 'bad-event', detail: 'not an embedding answer' });
  return { answer: { ok: true, model: model.id, vectors: parsed.vectors }, receipt: receipt({ state: 'done', cut: null, error: null, usage: parsed.usage, cost: parsed.cost }) };
}
