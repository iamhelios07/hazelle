import { modelSettings } from '../connectors/registry';
import { fit, type ModelSettings } from '../connectors/settings';
import type { Starred } from '../connectors/types';
import type { Pack } from '../engine/import/types';
import { readToggles } from '../engine/import/toggles';
import type { Assembled, PromptInput, RanAway, TooLong } from '../engine/pipeline';
import type { Display } from '../engine/display';
import type { Box } from '../engine/regex/scripts';
import type { ChatScope } from '../engine/render';
import type { TranslationRequest } from '../engine/translate';
import { shown, type Chat, type Message } from '../model/chat';
import type { Stored } from '../model/kinds';
import { live } from '../model/library';
import type { Toggle } from '../model/prompt';
import { SETTINGS_ID } from '../model/settings';
import { chatToggles, toggleValue } from '../model/toggles';
import { chatModel, type Route, type RouteFailure } from './assignment';
import { translateSwitches } from './characters';
import { memoryInput } from './memory';
import { chatPersona } from './personas';
import { modelProfile } from './profiles';
import { chatPrompt, type PromptChoice } from './prompts';
import type { Session } from './session';
import type { ApiFailure } from './api';
import type { CacheSend } from './cache';
import type { Halted } from './scripts';
import { appendUserMessage, startChat, type Said, type Written } from './chat-log';
import { greetingOf, type Greetings } from './greetings';
import { cacheViewOf } from './generate';
import { type Ask, type Shown, type TalkFailure, type Turn } from './talk';
import { EvaluationFailed, EvaluationStopped, evaluationFailure } from './evaluation';
import { endCall, type CallTarget } from './streams';
import { resumeTranslation, translate, type TranslateFailure, type TranslateInput } from './translate';

export type Target =
  | { kind: 'send'; text: string }
  | { kind: 'answer' }
  | { kind: 'regenerate'; message: string }
  | { kind: 'retry'; message: string; version: string }
  | { kind: 'continue'; message: string; version: string };

// own says whether the missing one was the chat's (the model's) own or the default.
export type Blocked = RouteFailure | { kind: 'prompt-missing'; own: boolean } | { kind: 'persona-missing'; own: boolean } | { kind: 'profile-missing'; own: boolean };
// A turn also stops before sending on a new chat that was not saved, a pull that failed, a chat or message another
// device deleted, a user's message that was not translated, a tokenizer that did not load, or a prompt over the
// model's budget.
// kept: the user's message was saved all the same (a bot with Lua has it saved before its onStart runs), so the
// screen does not hand its text back.
export type TurnFailure = (
  | TalkFailure
  | Blocked
  | TooLong
  | RanAway
  | { kind: 'tokenizer' }
  | { kind: 'unstarted'; failure: ApiFailure }
  | { kind: 'unpulled'; failure: ApiFailure }
  | { kind: 'gone' }
  | { kind: 'untranslated'; failure: TranslateFailure }
) & { kept?: true };

// Read once when it is asked for, the user's new message last in its messages.
export type TurnContext = Pick<Ask, 'route' | 'settings' | 'said'> & Pick<Turn, 'reply'> & Pick<PromptInput, 'scope' | 'budget' | 'memory'> & { chat: Chat };

type Reader = Pick<Session, 'store'>;

// Order (design §6.5): its character's own, then the modules on in every chat, then the character's, each once. A
// module that is gone or deleted is off.
// module: null for the character's own pack.
export function packsOf(store: Reader['store'], chat: Pick<Chat, 'character'>): { id: string; pack: Pack; module: { namespace: string | null } | null }[] {
  const character = chat.character === null ? null : store.get('character', chat.character);
  const modules = [...new Set([...(store.get('settings', SETTINGS_ID)?.value.modules ?? []), ...(character?.value.modules ?? [])])];
  return [
    ...(character ? [{ id: character.id, pack: character.value.card, module: null }] : []),
    ...modules.flatMap((id) => {
      const module = store.get('module', id)?.value;
      return module && module.deleted === undefined ? [{ id, pack: module, module: { namespace: module.namespace } }] : [];
    }),
  ];
}

// id is null for a chat not saved yet.
export function scopeOf({ store }: Reader, id: string | null, chat: Chat, messages: Message[]): ChatScope {
  const character = chat.character === null ? null : (store.get('character', chat.character)?.value ?? null);
  const card = character?.card ?? null;
  const packs = packsOf(store, chat);
  const cast = (chat.cast ?? []).flatMap((member) => live(store.get('character', member)) ?? []);
  // A 등장인물's lorebook and pictures follow the packs', its pictures with no module namespace, as the character's own.
  const owners = [...packs, ...cast.map(({ id }) => ({ id, module: null }))];
  const prompt = chatPrompt(store, chat);
  const persona = chatPersona(store, chat);
  const route = chatModel(store, chat, 'main');
  const toggles = togglesOf(store, chat, prompt);
  return {
    card,
    cast: cast.map(({ id, value }) => ({ id, card: value.card })),
    packs: packs.map(({ pack }) => pack),
    persona: persona.kind === 'persona' ? { name: persona.persona.value.name, description: persona.persona.value.description } : null,
    prompt: prompt.kind === 'prompt' ? prompt.prompt.value : null,
    note: chat.note ?? null,
    lore: owners.flatMap(({ id: owner }) => store.children('lore', owner)),
    messages: messages.map((message) => {
      const version = shown(message);
      const after = [...(version.after ?? []), ...(message.after ?? [])];
      return { id: version.id, seed: version.seed, role: message.role, text: version.text, time: version.at, ...(version.staged && { staged: true }), ...(version.before && { before: version.before }), ...(after.length > 0 && { after }) };
    }),
    variables: chat.variables ?? [],
    greeting: card && greetingOf(messages),
    toggles: new Map(toggles.declared.map(({ key }) => [key, toggles.value(key)])),
    model: 'kind' in route ? null : botModel(route, sentSettings(store, route)),
    clock: { now: Date.now(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    assets: owners.flatMap(({ id: owner, module }) => store.children('asset', owner).map(({ id, value }) => ({ id, name: value.name, ...(module && { module: module.namespace }) }))),
    modules: packs.flatMap(({ module }) => module?.namespace ?? []),
    faces: {
      char: chat.character === null ? null : (store.children('avatar', chat.character)[0]?.value.thumb ?? null),
      user: persona.kind === 'persona' ? persona.persona.value.picture : null,
    },
    screen: null,
    pick: `${chat.character ?? ''}:${chat.seed ?? id ?? ''}`,
  };
}

export type ChatToggleSet = { declared: Toggle[]; value: (key: string) => string | null };

export function togglesOf(store: Session['store'], chat: Chat, prompt: PromptChoice): ChatToggleSet {
  const character = chat.character === null ? null : (store.get('character', chat.character)?.value ?? null);
  const declared = chatToggles(prompt.kind === 'prompt' ? prompt.prompt.value.toggles : [], packsOf(store, chat).flatMap(({ pack }) => readToggles(pack.toggles).toggles));
  return { declared, value: toggleValue(declared, (character ? character.toggles : store.get('settings', SETTINGS_ID)?.value.toggles) ?? {}) };
}

// null while its 묶음 is missing, which a turn stops on.
function sentSettings(store: Reader['store'], { connection, model }: Route): ModelSettings | null {
  const profile = modelProfile(store, model);
  if (profile.kind === 'missing') return null;
  const schema = modelSettings(connection.value, model);
  return schema ? fit(schema, profile.profile.value.settings).settings : profile.profile.value.settings;
}

const contextOf = (model: Starred, settings: ModelSettings | null) => settings?.context ?? model.contextLength;
const replyOf = (model: Starred, settings: ModelSettings | null) => settings?.maxOutput ?? model.maxOutput;

function botModel(route: Route, settings: ModelSettings | null): ChatScope['model'] {
  const { connection, model } = route;
  return { id: model.id, maxContext: contextOf(model, settings), prefill: modelSettings(connection.value, model)?.prefill ?? null };
}

// A reply length nobody knows reserves nothing.
function budgetOf(model: Starred, settings: ModelSettings | null): number | null {
  const context = contextOf(model, settings);
  return context === null ? null : context - (replyOf(model, settings) ?? 0);
}

// null when the chat has no 대화 모델 or the context is unknown.
export function promptBudget(store: Reader['store'], chat: Chat): number | null {
  const route = chatModel(store, chat, 'main');
  return 'kind' in route ? null : budgetOf(route.model, sentSettings(store, route));
}

// A chat's messages as a request sends them: under 반전 모드, each with its shown version's translation as its text.
export const asSent = (store: Reader['store'], chat: Chat, messages: Message[]) => (translateSwitches(store, chat.character).reverse ? messages.map(reversed) : messages);

// screen: the window the chat is shown in, for a bot's layout; null for what is not shown, such as a preview.
export const evaluateChat = async (reader: Reader, id: string | null, chat: Chat, messages: Message[], screen: ChatScope['screen'] = null, signal?: AbortSignal): Promise<Display> =>
  (await reader.store.evaluation.display(`headless:${id}`, { ...scopeOf(reader, id, chat, messages), screen }, pinned(reader, chat), signal)).display;

// The status window's scripts (상태창 지정), whose boxes leave every message and what is translated of it, unless
// 봇 꾸밈 is off; the chat draws the latest box itself.
export function pinned({ store }: Reader, chat: Chat): ReadonlySet<number> {
  const character = chat.character === null ? null : store.get('character', chat.character)?.value;
  return new Set(character?.decor === false ? [] : (character?.statusScripts ?? []));
}

// A reply still being written is passed over, since half a box would show; so is a box its script left empty, as bots
// do on older messages. null: no message drew one yet.
export type StatusBox = { script: number; drawn: (Box & { message: number }) | null };

export function statusBoxes(shown: Display, messages: Shown[], scripts: readonly number[]): StatusBox[] {
  return scripts.map((script) => {
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index]!.live !== null) continue;
      const box = shown.boxes[index]!.find((each) => each.script === script);
      if (box?.html.trim()) return { script, drawn: { ...box, message: index } };
    }
    return { script, drawn: null };
  });
}

export function translationInput(reader: Reader, id: string, chat: Chat, messages: Message[], request: TranslationRequest): TranslateInput {
  return { chat, scope: scopeOf(reader, id, chat, messages), take: pinned(reader, chat), translations: messages.map((message) => shown(message).translation?.text ?? null), request };
}

// Automatic 답장 번역 is for replies received here, never for what a chat already holds: opening a chat, a greeting, a
// version switched to and the switch turned on leave it to 번역 (user ruling, 2026-10-04). The reply is as saved; the
// bot's onOutput may have edited or removed its message since, so the message is read again. Its chat must stay
// loaded until this returns (session).
async function translateReceived(session: Pick<Session, 'store' | 'read' | 'translator'>, chat: string, reply: Written) {
  if (reply.receipt.state === 'failed') return;
  const view = await displayed(session, chat);
  if (!view || !translateSwitches(session.store, view.chat.character).replies) return;
  const index = view.messages.findIndex((message) => message.id === (reply.message ?? reply.id));
  if (index === -1) return;
  const version = shown(view.messages[index]!);
  // Another version, already translated, may have been switched to while onOutput ran.
  if (version.translation || !view.display.texts[index]!.trim()) return;
  session.translator.translate(chat, version, translationInput(session, chat, view.chat, view.messages, { kind: 'message', index }));
}

const displayed = (session: Pick<Session, 'read'>, chat: string) =>
  session.read.displayed(chat).catch((error: unknown) => {
    if (error instanceof EvaluationStopped || error instanceof EvaluationFailed) return null;
    throw error;
  });

// 자동 이어 쓰기 (design §6.7): a reply cut at its length, or whose stream closed without its end (a deploy rebuilds the
// server object), is continued once (user, 2026-10-02). A continuation is never continued on its own, a manual one
// included; nor is a stop (멈추기), nor an empty reply, on which 이어 쓰기 is not offered either.
export function autoContinue({ text, receipt }: Pick<Written, 'text' | 'receipt'>): boolean {
  return receipt.state === 'cut' && (receipt.cut === 'length' || receipt.cut === 'no-terminal') && !receipt.continues && text !== '';
}

const idle = (talk: Session['talk'], chat: string) =>
  new Promise<void>((done) => {
    if (!talk.snapshot(chat)) return done();
    const stop = talk.subscribe(() => {
      if (talk.snapshot(chat)) return;
      stop();
      done();
    });
  });

// A reply this page has just saved (session's saved hook): continued when autoContinue says so and it is still the
// chat's last message as saved, else translated. Never both: a continuation that ran leaves the translation to the hook
// its own save calls, on the finished version. takeTurn answers null as well when a turn its chat began meanwhile turned it
// away, and the cut reply then stays untranslated. Its chat must stay loaded until this returns (session).
export async function receiveReply(session: Session, chat: string, reply: Written) {
  if (autoContinue(reply)) {
    // The reply's own turn still holds its chat in Talk when its save calls the hook.
    await idle(session.talk, chat);
    const last = (await displayed(session, chat))?.messages.at(-1);
    // An onOutput edit is a version of its own, which is not continued, as 이어 쓰기 is not offered on it.
    if (last?.id === (reply.message ?? reply.id) && shown(last).id === reply.id) {
      const failure = await takeTurn(session, chat, { kind: 'continue', message: last.id, version: reply.id });
      if (!failure) return;
    }
  }
  await translateReceived(session, chat, reply);
}

function sendable(scope: ChatScope, chat: Chat): PromptInput['scope'] | Blocked {
  const { prompt, persona } = scope;
  if (!prompt) return { kind: 'prompt-missing', own: chat.prompt !== undefined };
  if (!persona) return { kind: 'persona-missing', own: chat.persona !== undefined };
  return { ...scope, prompt, persona };
}

// null: nothing stops the chat from starting a turn. The screen asks before it saves a new chat.
export function blocked(reader: Reader, chat: Chat): Blocked | null {
  const route = chatModel(reader.store, chat, 'main');
  if ('kind' in route) return route;
  const profile = modelProfile(reader.store, route.model);
  if (profile.kind === 'missing') return { kind: 'profile-missing', own: profile.own };
  const scope = sendable(scopeOf(reader, null, chat, []), chat);
  return 'kind' in scope ? scope : null;
}

// null: the chat, or the message the target names, is gone; for a continue, so is the version it names. ids are
// the ones the turn was shown under, for a new chat shown before it was saved.
function gatherTurn(session: Pick<Session, 'store' | 'read'>, chat: string, target: Target, ids = { said: crypto.randomUUID(), reply: crypto.randomUUID() }): TurnContext | Blocked | null {
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
  const said: Said | null = target.kind === 'send' ? { id: ids.said, text: target.text } : null;
  const now = Date.now();
  const sending: Message[] = said ? [{ id: said.id, role: 'user', at: now, versions: [{ id: said.id, seed: said.id, text: said.text, receipt: null, edited: false, at: now }], selected: 0 }] : [];
  // 반전 모드 sends the messages before the target as the reader reads them. A continuation's prompt ends with the
  // version it continues, as its text, which the continuation is written after.
  const before = asSent(session.store, stored.value, messages.slice(0, at));
  const history = continues ? [...before, { ...messages[at]!, selected: index }] : [...before, ...sending];
  const scope = sendable(scopeOf(session, chat, stored.value, history), stored.value);
  if ('kind' in scope) return scope;
  return {
    chat: stored.value,
    route,
    settings,
    scope,
    budget: budgetOf(route.model, sentSettings(session.store, route)),
    memory: memoryInput(session.store, chat, stored.value, history),
    said,
    reply: { id: ids.reply, message, replaces: 'version' in target ? target.version : null, continues },
  };
}

// null while it cannot send, or the prompt is over the model's budget.
export type Sending = { turn: TurnContext; prompt: Assembled };

// asker: whose forecast this is, each with its own evaluation lane, kept with the chat so a forecast sends the worker
// only what changed since its last: the composer's, background memory's (Rememberer) and the memory panel's. One lane
// shared by two would have each cancel the other's.
export async function wouldSend(session: Pick<Session, 'store' | 'read'>, chat: string, target: Target, signal?: AbortSignal, asker: 'forecast' | 'memory' | 'view' = 'forecast'): Promise<Sending | null> {
  // What the prompt reads may change while it is evaluated: it is gathered and evaluated again once, so a save landing
  // mid-flight does not cost memory its round.
  for (let tries = 0; tries < 2; tries++) {
    const projection = await session.store.evaluated(chat);
    if (!projection) return null;
    const { value: turn, reads } = session.store.capture(() => gatherTurn(session, chat, target));
    const revisions = reads.map((read) => session.store.revision(read));
    if (turn === null || 'kind' in turn) return null;
    const prompt = await session.store.evaluation.prompt(`${asker}:${chat}`, { scope: turn.scope, seed: turn.reply.id, budget: turn.budget, continuing: false, memory: turn.memory }, signal);
    if (signal?.aborted) return null;
    if (session.store.loadedHead(chat) === projection.summary.head && reads.every((read, at) => session.store.revision(read) === revisions[at])) return 'kind' in prompt ? null : { turn, prompt };
  }
  return null;
}

export function cacheSend({ turn, prompt }: Sending): CacheSend | null {
  const view = cacheViewOf(turn.route.connection.value, turn.route.model, turn.settings, prompt.messages);
  return view && { connection: turn.route.connection.id, view, parts: prompt.parts };
}

function reversed(message: Message): Message {
  const version = shown(message);
  return version.translation ? { ...message, versions: message.versions.with(message.selected, { ...version, text: version.translation.text }) } : message;
}

// start: the new chat to save first, which the turn is shown in while it is saved; started runs once it is.
export function takeTurn(session: Session, chat: string, target: Target, start: { chat: Chat; greetings: Greetings | null; started: () => void } | null = null): Promise<TurnFailure | null> {
  if (start) {
    const ids = { said: crypto.randomUUID(), reply: crypto.randomUUID() };
    const said = target.kind === 'send' ? { id: ids.said, text: target.text } : null;
    const again = (answer: boolean) => gatheredTurn(session, chat, answer ? { kind: 'answer' } : target, ids);
    return unhalted(session.talk.run({ chat, said, reply: { id: ids.reply, message: null, replaces: null, continues: null } }, async (signal) => {
      const unstarted = await startChat(session.store, chat, start.chat, start.greetings);
      if (unstarted) return { kind: 'unstarted', failure: unstarted };
      start.started();
      // The chat was just saved and a new chat's target names no message, so it is there.
      const turn = (await gatheredTurn(session, chat, target, ids))!;
      return 'kind' in turn ? turn : prepare(session, chat, turn, signal, again);
    }));
  }
  const lease = session.store.retainChat(chat);
  const send = (): Promise<TurnFailure | null> => {
    const ids = { said: crypto.randomUUID(), reply: crypto.randomUUID() };
    const showing = gatherTurn(session, chat, target, ids);
    if (showing === null || 'kind' in showing) return Promise.resolve(showing);
    const again = (answer: boolean) => gatheredTurn(session, chat, answer ? { kind: 'answer' } : target, ids);
    return unhalted(session.talk.run({ chat, said: showing.said, reply: showing.reply }, async (signal) => {
      // Another device may have written to this chat while this page stood open without focus or a timer's pull, so the
      // prompt is gathered again after a pull. A turn it cannot pull does not send on what may be stale.
      const unpulled = await session.store.pull();
      if (unpulled) return { kind: 'unpulled', failure: unpulled };
      const turn = await gatheredTurn(session, chat, target, ids);
      if (turn === null) return { kind: 'gone' };
      return 'kind' in turn ? turn : prepare(session, chat, turn, signal, again);
    }));
  };
  const sending = lease.ready.then((failure): Promise<TurnFailure | null> => failure ? Promise.resolve({ kind: 'unpulled', failure }) : send());
  return sending.finally(lease.release);
}

// A turn the bot's Lua ended before any request (stopChat) is not a failure: the user's message stays, and nothing
// is said of it.
const unhalted = (turn: Promise<TurnFailure | Halted | null>): Promise<TurnFailure | null> => turn.then((failure) => (failure?.kind === 'halted' ? null : failure));

// Stopped with the turn, or a worker that failed. Either way the screen puts the typed text back and reports it, as for
// any message not sent.
type Unevaluated = { kind: 'unsent'; failure: ApiFailure };
const evaluating = <T>(work: Promise<T>): Promise<T | Unevaluated> => work.catch((error: unknown) => ({ kind: 'unsent' as const, failure: evaluationFailure(error) }));

// The turn as the chat stands once what was last written to it is evaluated: a write returns before its chat's
// projection is made again (ObjectStore.refreshHeld).
async function gatheredTurn(session: Pick<Session, 'store' | 'read'>, chat: string, target: Target, ids: Parameters<typeof gatherTurn>[3]): Promise<TurnContext | Blocked | Unevaluated | null> {
  const evaluated = await evaluating(session.store.evaluated(chat));
  return evaluated && 'kind' in evaluated ? evaluated : gatherTurn(session, chat, target, ids);
}

async function prepare(session: Session, chat: string, gathered: TurnContext, signal: AbortSignal, again: (answer: boolean) => Promise<TurnContext | Blocked | Unevaluated | null>): Promise<Ask | Halted | TurnFailure> {
  const translated = gathered.said && translateSwitches(session.store, gathered.chat.character).input ? await sendTranslated(session, chat, gathered, signal) : gathered;
  if ('kind' in translated) return translated;
  const started = await session.scripts.starting(chat, translated, again, signal);
  if ('kind' in started) return started;
  const { route, settings, scope, budget, memory, said, reply } = started.turn;
  const kept = translated.said !== null && said === null ? { kept: true as const } : {};
  const prompt = await evaluating(session.store.evaluation.prompt(`send:${chat}`, { scope, seed: reply.id, budget, continuing: reply.continues !== null, memory }, signal));
  if ('kind' in prompt) return { ...prompt, ...kept };
  const requested = await session.scripts.requesting(chat, started.turn, prompt.messages);
  const sent = requested.messages === prompt.messages ? prompt : await evaluating(session.store.evaluation.rewrite(`send:${chat}`, scope, { prompt, messages: requested.messages, budget }, signal));
  if ('kind' in sent) return { ...sent, ...kept };
  const before = [...(reply.before ?? []), ...requested.writes];
  return { route, settings, prompt: sent, said, ...(before.length > 0 && { before }) };
}

// A message being translated for sending when this page came, which Streams hands over. It is saved translated, or
// as typed when the translation failed, so what the user wrote is never lost; its reply waits for 답장 받기, since
// another device may be reading the same call.
export async function resumeSend(session: Pick<Session, 'store' | 'streams'>, stream: Stored<'stream'>, signal: AbortSignal) {
  const purpose = stream.value.for;
  if (purpose.kind !== 'input') return;
  const lease = session.store.retainChat(stream.parent!);
  try {
    if (await lease.ready) return;
    session.streams.reading.add(stream.id);
    const made = await resumeTranslation(session.store, stream, signal, () => {}).finally(() => session.streams.reading.delete(stream.id));
    if (!made.ok && made.failure.kind === 'stopped') return;
    const id = stream.value.result;
    const said = made.ok ? { id, text: made.translation.text, translation: { ...made.translation, text: purpose.typed, sentIn: purpose.language } } : { id, text: purpose.typed };
    const saved = await appendUserMessage(session.store, stream.parent!, said);
    if (!saved.ok && saved.error === 'stopped') return;
    if (saved.ok || session.store.children('entry', stream.parent!).some((entry) => entry.id === id)) endCall(session.store, stream.id);
  } finally { lease.release(); }
}

// The user's message goes out translated, which the prompt sends and the chat saves as its text, with
// what the user typed as its translation. The chat's messages before it are the translation's context.
// Its call ends as soon as it is translated: a marker left until the message is saved would let a pick-up save the
// message a second time, beside Talk's own save.
async function sendTranslated(session: Session, chat: string, turn: TurnContext, signal: AbortSignal): Promise<TurnContext | Extract<TurnFailure, { kind: 'untranslated' }>> {
  const typed = turn.said!;
  const messages = session.read.chat(chat).snapshot()!.messages;
  const language = translateSwitches(session.store, turn.chat.character).inputLanguage;
  const target: CallTarget = { id: crypto.randomUUID(), chat, result: typed.id, for: { kind: 'input', typed: typed.text, language } };
  session.streams.reading.add(target.id);
  const made = await translate(session, translationInput(session, chat, turn.chat, messages, { kind: 'input', text: typed.text }), target, signal, () => {}).finally(() =>
    session.streams.reading.delete(target.id),
  );
  endCall(session.store, target.id);
  if (!made.ok) return { kind: 'untranslated', failure: made.failure };
  const sent = made.translation.text;
  const last = turn.scope.messages.at(-1)!;
  return {
    ...turn,
    scope: { ...turn.scope, messages: turn.scope.messages.with(-1, { ...last, text: sent }) },
    said: { id: typed.id, text: sent, translation: { ...made.translation, text: typed.text, sentIn: language } },
  };
}
