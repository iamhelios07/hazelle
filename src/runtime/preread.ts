import { resolveRole, sameModelRef } from '../connectors/assignment';
import { costUnit, modelSettings, resolveConnection } from '../connectors/registry';
import type { Pdf } from '../connectors/settings';
import type { Cost } from '../connectors/types';
import { fingerprint } from '../engine/memory';
import type { Assembled, RanAway } from '../engine/pipeline';
import { coverage, placeBrief, prereadPlan, savedCost, type Covered } from '../engine/preread';
import type { ChatScope } from '../engine/render';
import type { Chat, Receipt } from '../model/chat';
import { EMPTY_SETTINGS, SETTINGS_ID, type PrereadSettings } from '../model/settings';
import type { ApiFailure } from './api';
import type { Route, RouteFailure } from './assignment';
import { evaluatingTask } from './evaluation';
import { taskWriter } from './profiles';
import { prereadPrompt } from './prompts';
import type { Session } from './session';
import type { ObjectStore } from './store';
import { pageAnswer } from './talk';
import { chatPlace, keepRow } from './usage';

// 토큰 절약 (runtime/turn prepare): the 보조 model reads the chosen parts of the request and writes a brief the chat model
// gets in their place (engine/preread).

// Agent defaults (2026-10-19), open to change: a system prompt carries format rules and jailbreak wording that lose
// force in a paraphrase, so it stays out; six messages are the last three exchanges; batch 4,000 tokens.
export const PREREAD_STARTS: PrereadSettings = { parts: { chat: true, system: false, lore: true }, recent: 6, batch: 4000 };

export function prereadSetup(store: Pick<ObjectStore, 'get'>): PrereadSettings {
  const own = store.get('settings', SETTINGS_ID)?.value.preread;
  return { parts: { ...PREREAD_STARTS.parts, ...own?.parts }, recent: own?.recent ?? PREREAD_STARTS.recent, batch: own?.batch ?? PREREAD_STARTS.batch };
}

// Whether 공용 leaves the brief to the 대화 모델 itself: no model on the 토큰 절약 prompt and no 보조 모델, so the expensive
// model reads the whole material and then writes the reply too.
export function briefsWithChatModel(store: Pick<ObjectStore, 'get'>): boolean {
  const models = store.get('settings', SETTINGS_ID)?.value.models ?? {};
  const prompt = prereadPrompt(store);
  const writer = (prompt.kind === 'prompt' ? prompt.prompt.value.model : undefined) ?? resolveRole('aux', [models]);
  const main = resolveRole('main', [models]);
  return writer !== null && main !== null && sameModelRef(writer, main);
}

export const setPreread = (store: ObjectStore, change: Partial<PrereadSettings>) =>
  store.upsert('settings', (current = EMPTY_SETTINGS) => ({ ...current, preread: { ...current.preread, ...change } }));

// failed: the call failed, or answered with no brief. Either fails the turn: sending the whole prompt unasked could cost
// many times more and overflow the chat model's window.
export type PrereadFailure =
  | RouteFailure
  | { kind: 'prompt-missing' }
  | { kind: 'profile-missing'; own: boolean }
  | { kind: 'tokenizer' }
  | RanAway
  | { kind: 'stopped' }
  | { kind: 'failed'; receipt: Receipt }
  | { kind: 'unsaved'; failure: ApiFailure };

export type Preread = NonNullable<Receipt['preread']>;

// By chat, the latest brief: who it covers, and the prompt and model that wrote it (key). Later turns reuse it until
// what it does not cover reaches batch or it goes stale (engine/preread coverage). Never stored: a reload makes it again.
export type Briefs = Map<string, { key: string; brief: string; tokens: number; covered: Covered[]; receipt: Receipt }>;

// The material always goes as a PDF where the route can take one, whatever the 토큰 절약 model's 설정 묶음 says: the cheap
// read is why this step exists. The instruction ahead of it stays out of the PDF.
const PACKED: Pdf = { keep: 'system', recent: 0 };
const packs = ({ connection, model }: Route) => modelSettings(connection.value, model)?.pdf !== false;

type Deps = Pick<Session, 'store' | 'tokens' | 'credentials' | 'log' | 'briefs'>;

// main: the chat model's route, whose input price the saving is counted at. shown: the 토큰 절약 call is about to start,
// which the reply's placeholder says. A request with less to shorten than batch, and no brief to reuse, goes as it is.
export async function preread(session: Deps, chat: string, stored: Chat, scope: ChatScope, sent: Assembled, main: Route, seed: string, signal: AbortSignal, shown: () => void): Promise<{ prompt: Assembled; preread: Preread | null } | PrereadFailure> {
  const { store, briefs } = session;
  const raw = { prompt: sent, preread: null };
  const setup = prereadSetup(store);
  const plan = prereadPlan(sent, setup);
  if (!plan) return raw;
  const kept = briefs.get(chat);
  const cover = kept && coverage(sent, plan, kept.covered, new Set(scope.messages.map(({ message }) => message)));
  const fresh = cover && !cover.stale && cover.replaced.length > 0 ? cover : null;
  if (!fresh && plan.tokens < setup.batch) return raw;
  const prompt = prereadPrompt(store);
  if (prompt.kind === 'missing') return { kind: 'prompt-missing' };
  const writer = taskWriter(store, stored, prompt.prompt.value.model);
  if ('kind' in writer) return writer;
  const { route } = writer;
  const key = fingerprint([{ role: 'prompt', text: `${prompt.prompt.id}:${prompt.prompt.rev}` }, { role: 'model', text: `${route.connection.id}:${route.model.id}` }]);
  const unit = costUnit(resolveConnection(main.connection.value)?.type ?? null);
  const shortened = (replaced: number[], brief: string, tokens: number, receipt: Receipt, spent: Cost | null, reused: boolean) => {
    const material = replaced.reduce((sum, at) => sum + sent.parts[at]!.tokens, 0);
    const saved = savedCost(material - tokens, main.model.price, unit, spent);
    return { prompt: placeBrief(sent, replaced, brief, tokens), preread: { material, brief: tokens, receipt, saved, ...(reused && { reused: true as const }) } };
  };
  if (fresh && kept!.key === key && (fresh.uncovered === 0 || fresh.uncovered < setup.batch)) return shortened(fresh.replaced, kept!.brief, kept!.tokens, kept!.receipt, { unit, amount: 0, source: 'price-list' }, true);
  if (plan.tokens < setup.batch) return raw;
  shown();
  const assembled = await evaluatingTask(store.evaluation.preread({ asker: 'send', chat }, { scope, prompt: prompt.prompt.value, material: plan.material, seed }, signal));
  if ('kind' in assembled) return assembled;
  const settings = packs(route) ? { ...writer.settings, pdf: PACKED } : writer.settings;
  const answer = await pageAnswer(session, { route, settings }, 'preread', chat, assembled.messages, signal);
  if ('kind' in answer) return answer;
  const brief = answer.text.trim();
  if (!brief) return { kind: 'failed', receipt: answer.receipt };
  const { receipt } = answer;
  await keepRow(store, receipt, Date.now(), chatPlace(store, chat));
  const counted = await evaluatingTask(store.evaluation.count([brief]));
  if ('kind' in counted) return counted;
  const tokens = counted[0]!;
  briefs.set(chat, { key, brief, tokens, covered: plan.covered, receipt });
  return shortened(plan.taken, brief, tokens, receipt, receipt.cost === 'pending' ? null : receipt.cost, false);
}
