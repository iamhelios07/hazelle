import { providerFit, type TokenSnapshot } from './token-calibration';
import type { Assembled, PromptInput } from '../engine/pipeline';
import type { ChatScope } from '../engine/render';
import { shown, type Chat, type Message } from '../model/chat';
import { live } from '../model/library';
import { chatModel, type RouteFailure } from './assignment';
import { wireOf, type CacheSend } from './cache';
import { asSent, budgetOf, tokenLimits, scopeOf, sentSettings } from './chat-context';
import type { Said } from './chat-log';
import { cacheViewOf } from './generate';
import { memoryFill } from './memory-read';
import { chatPersona, type PersonaSource } from './personas';
import { modelProfile } from './profiles';
import type { Session } from './session';
import type { Ask, Turn } from './talk';

type Reader = Pick<Session, 'store'>;

export type Target =
  | { kind: 'send'; text: string }
  | { kind: 'answer' }
  | { kind: 'regenerate'; message: string }
  | { kind: 'retry'; message: string; version: string }
  | { kind: 'continue'; message: string; version: string };

// own says whether the missing one was the chat's (the model's) own or the default.
export type Blocked = RouteFailure | { kind: 'prompt-missing'; own: boolean } | { kind: 'persona-missing'; from: PersonaSource } | { kind: 'profile-missing'; own: boolean };

const BLOCKED = { 'no-model': true, 'model-gone': true, 'image-only': true, 'prompt-missing': true, 'persona-missing': true, 'profile-missing': true } as const satisfies Record<Blocked['kind'], true>;

export const isBlocked = (failure: { kind: string }): failure is Blocked => Object.hasOwn(BLOCKED, failure.kind);

// Read once when it is asked for, the user's new message last in its messages.
export type TurnContext = Pick<Ask, 'route' | 'settings' | 'said'> & Pick<Turn, 'reply'> & Pick<PromptInput, 'scope' | 'budget' | 'memory'> & { chat: Chat };

function sendable({ store }: Reader, scope: ChatScope, chat: Chat): PromptInput['scope'] | Blocked {
  const { prompt, persona } = scope;
  if (!prompt) return { kind: 'prompt-missing', own: chat.prompt !== undefined };
  if (!persona) return { kind: 'persona-missing', from: chatPersona(store, chat).from };
  return { ...scope, prompt, persona };
}

// null: nothing stops the chat from starting a turn. The screen asks before it saves a new chat.
export function blocked(reader: Reader, chat: Chat): Blocked | null {
  const route = chatModel(reader.store, chat, 'main');
  if ('kind' in route) return route;
  const profile = modelProfile(reader.store, route.model);
  if (profile.kind === 'missing') return { kind: 'profile-missing', own: profile.own };
  const scope = sendable(reader, scopeOf(reader, null, chat, []), chat);
  return 'kind' in scope ? scope : null;
}

// null: the chat, or the message the target names, is gone; for a continue, so is the version it names. ids are
// the ones the turn was shown under, for a new chat shown before it was saved.
export function gatherTurn(session: Pick<Session, 'store' | 'read'>, chat: string, target: Target, ids = { said: crypto.randomUUID(), reply: crypto.randomUUID() }): TurnContext | Blocked | null {
  const stored = live(session.store.get('chat', chat));
  if (!stored) return null;
  const route = chatModel(session.store, stored.value, 'main');
  if ('kind' in route) return route;
  const profile = modelProfile(session.store, route.model);
  if (profile.kind === 'missing') return { kind: 'profile-missing', own: profile.own };
  const { settings } = profile.profile.value;

  const messages = session.read.chat(chat).snapshot()!.messages;
  const message = 'message' in target ? target.message : null;
  const at = message === null ? messages.length : messages.findIndex((candidate) => candidate.id === message);
  if (at === -1) return null;
  const index = 'version' in target ? messages[at]!.versions.findIndex((version) => version.id === target.version) : -1;
  const version = messages[at]?.versions[index];
  // 이어 쓰기 continues the version it names. So does 다시 시도 on a continuation that failed, so that neither the text
  // it continues nor the calls its receipt carries are dropped.
  const continues = version?.receipt && (target.kind === 'continue' || version.receipt.continues) ? { text: version.text, receipt: version.receipt, seed: version.seed, ...(version.reasoning && { reasoning: version.reasoning }) } : null;
  if (target.kind === 'continue' && !continues) return null;
  const end = messages.at(-1);
  const follows = end ? shown(end).id : null;
  const said: Said | null = target.kind === 'send' ? { id: ids.said, text: target.text, follows } : null;
  const now = Date.now();
  const sending: Message[] = said ? [{ id: said.id, role: 'user', at: now, versions: [{ id: said.id, seed: said.id, text: said.text, receipt: null, edited: false, at: now }], selected: 0 }] : [];
  // 반전 모드 sends the messages before the target as the reader reads them. A continuation's prompt ends with the
  // version it continues, as its text, which the continuation is written after.
  const before = asSent(session.store, stored.value, messages.slice(0, at));
  const history = continues ? [...before, { ...messages[at]!, selected: index }] : [...before, ...sending];
  const scope = sendable(session, scopeOf(session, chat, stored.value, history), stored.value);
  if ('kind' in scope) return scope;
  return {
    chat: stored.value,
    route,
    settings,
    scope,
    budget: budgetOf(route.model, sentSettings(session.store, route)),
    memory: memoryFill(session.store, chat, stored.value, history),
    said,
    reply: { id: ids.reply, message, replaces: 'version' in target ? target.version : null, ...(message === null && { follows: said ? said.id : follows }), continues },
  };
}

// null while it cannot send, or the prompt is over the model's budget.
export type Sending = { turn: TurnContext; prompt: Assembled; calibration: TokenSnapshot };

// asker: whose forecast this is, each with its own evaluation lane, kept with the chat so a forecast sends the worker
// only what changed since its last: the composer's, background memory's (Rememberer) and the memory panel's. One lane
// shared by two would have each cancel the other's.
export async function wouldSend(session: Pick<Session, 'store' | 'read' | 'scripts' | 'tokens'>, chat: string, target: Target, signal?: AbortSignal, asker: 'forecast' | 'memory' | 'view' = 'forecast'): Promise<Sending | null> {
  // What the prompt reads may change while it is evaluated: it is gathered and evaluated again once, so a save landing
  // mid-flight does not cost memory its round.
  for (let tries = 0; tries < 2; tries++) {
    const projection = await session.store.projections.evaluate(chat);
    if (!projection) return null;
    const { value: turn, reads } = session.store.capture(() => gatherTurn(session, chat, target));
    const revisions = reads.map((read) => session.store.revision(read));
    if (turn === null || 'kind' in turn) return null;
    const snapshot = await session.tokens.snapshot(turn.route, turn.settings, tokenLimits(turn.route.model, sentSettings(session.store, turn.route)), 'conversation', chat, signal ?? new AbortController().signal);
    if (!snapshot.ok) return null;
    const fit = providerFit(turn.route, turn.settings, snapshot.data.fit.allowance);
    const prompt = await session.store.evaluation.prompt({ asker, chat }, { scope: turn.scope, seed: turn.reply.id, budget: turn.budget, fit, ...session.scripts.cachedPrompt(chat, turn), continuing: false }, signal);
    if (signal?.aborted) return null;
    if (session.store.loadedHead(chat) === projection.summary.head && reads.every((read, at) => session.store.revision(read) === revisions[at])) return 'kind' in prompt ? null : { turn, prompt, calibration: snapshot.data };
  }
  return null;
}

// account: the account that would serve it (runtime/pool peek).
export function cacheSend({ turn, prompt, calibration }: Sending, account: string | null): CacheSend | null {
  const view = cacheViewOf(turn.route.connection.value, turn.route.model, turn.settings, prompt.messages);
  if (!view) return null;
  // Prefix composition can differ from the whole request; this remains a lower-bound forecast, not reported eligibility.
  const facts = view.facts && { ...view.facts, minimum: view.facts.minimum === null ? null : Math.ceil(view.facts.minimum / calibration.estimate.lower) };
  return { ...wireOf(turn.route.connection.id, account, view, prompt.parts), facts };
}
