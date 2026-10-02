import { modelSettings } from '../connectors/registry';
import { fit, type ModelSettings } from '../connectors/settings';
import type { Starred } from '../connectors/types';
import type { Card, Pack } from '../engine/import/types';
import { readToggles } from '../engine/import/toggles';
import { assemble, rewritten, type Assembled, type PromptInput, type RanAway, type TooLong } from '../engine/pipeline';
import { display, type Display } from '../engine/display';
import type { Box } from '../engine/regex/scripts';
import type { ChatScope } from '../engine/render';
import type { TranslationRequest } from '../engine/translate';
import { shown, type Chat, type Message } from '../model/chat';
import type { Stored } from '../model/kinds';
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
import { appendUserMessage, startChat, type Greetings, type Said } from './chat-log';
import { cacheViewOf } from './generate';
import { withTurn, type Ask, type Shown, type TalkFailure, type Turn } from './talk';
import { tokenizer } from './tokenizer';
import { endCall, type CallTarget } from './streams';
import { resumeTranslation, translate, type TranslateFailure, type TranslateInput } from './translate';

// What the user asks for: their new message and a reply to it, a reply to the last message sending
// nothing new (답장 받기), another version of a reply (새 답장 받기), one in place of a failed version
// (다시 시도), or the rest of a cut version, which takes its place (이어 쓰기).
export type Target =
  | { kind: 'send'; text: string }
  | { kind: 'answer' }
  | { kind: 'regenerate'; message: string }
  | { kind: 'retry'; message: string; version: string }
  | { kind: 'continue'; message: string; version: string };

// Why a chat cannot start a turn: no model, or its prompt, persona or its model's 설정 묶음 is missing; own says whether the missing one was the chat's (the model's) own or the default.
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

// Everything one reply needs, read once when it is asked for: the chat, the model, what the prompt is built from (the
// user's new message last in its messages), the message Talk saves with the reply, and where the reply goes.
export type TurnContext = Pick<Ask, 'route' | 'settings' | 'said'> & Pick<Turn, 'reply'> & Pick<PromptInput, 'scope' | 'budget' | 'memory'> & { chat: Chat };

type Reader = Pick<Session, 'store'>;

// A chat's packs with what holds each, in order (design §6.5): its character's own, then the modules on in every
// chat, then the character's, each once. The one place that knows a pack is a card's or a module's; a module that is
// gone or deleted is off.
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

// What a chat's text is rendered with, on screen and in a turn: its character's card, its packs with their lore and
// assets, its toggle values, its prompt, persona and note, and the model it talks to. id is null for a chat not saved
// yet.
export function scopeOf({ store }: Reader, id: string | null, chat: Chat, messages: Message[]): ChatScope {
  const character = chat.character === null ? null : (store.get('character', chat.character)?.value ?? null);
  const card = character?.card ?? null;
  const packs = packsOf(store, chat);
  const prompt = chatPrompt(store, chat);
  const persona = chatPersona(store, chat);
  const route = chatModel(store, chat, 'main');
  return {
    card,
    packs: packs.map(({ pack }) => pack),
    persona: persona.kind === 'persona' ? { name: persona.persona.value.name, description: persona.persona.value.description } : null,
    prompt: prompt.kind === 'prompt' ? prompt.prompt.value : null,
    note: chat.note ?? null,
    lore: packs.flatMap((pack) => store.children('lore', pack.id)),
    messages: messages.map((message) => {
      const version = shown(message);
      const after = [...(version.after ?? []), ...(message.after ?? [])];
      return { id: version.id, seed: version.seed, role: message.role, text: version.text, time: version.at, ...(version.staged && { staged: true }), ...(version.before && { before: version.before }), ...(after.length > 0 && { after }) };
    }),
    variables: chat.variables ?? [],
    greeting: card && greetingOf(card, messages),
    toggle: togglesOf(store, chat, prompt).value,
    model: 'kind' in route ? null : botModel(route, sentSettings(store, route)),
    clock: { now: Date.now(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    assets: packs.flatMap(({ id: pack, module }) => store.children('asset', pack).map(({ id, value }) => ({ id, name: value.name, ...(module && { module: module.namespace }) }))),
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

// A chat's toggles and their values: what its turns send with, and what its toggle panel lists.
export function togglesOf(store: Session['store'], chat: Chat, prompt: PromptChoice): ChatToggleSet {
  const character = chat.character === null ? null : (store.get('character', chat.character)?.value ?? null);
  const declared = chatToggles(prompt.kind === 'prompt' ? prompt.prompt.value.toggles : [], packsOf(store, chat).flatMap(({ pack }) => readToggles(pack.toggles).toggles));
  return { declared, value: toggleValue(declared, (character ? character.toggles : store.get('settings', SETTINGS_ID)?.value.toggles) ?? {}) };
}

// A chat's greeting is its first message when that is an assistant message the model did not write. Its index in the card is that of the shown version among the card's greetings that are not blank, which
// are the ones a chat saves.
function greetingOf(card: Card, messages: Message[]): ChatScope['greeting'] {
  const first = messages[0];
  if (first?.role !== 'assistant' || first.versions[0]!.receipt !== null) return null;
  const greetings = card.greetings.flatMap((text, index) => (text.trim() ? [index] : []));
  return { index: shown(first).receipt === null ? (greetings[first.selected] ?? null) : null };
}

// The 묶음's settings as this model is sent them; null while its 묶음 is missing, which a turn stops on.
function sentSettings(store: Reader['store'], { connection, model }: Route): ModelSettings | null {
  const profile = modelProfile(store, model);
  if (profile.kind === 'missing') return null;
  const schema = modelSettings(connection.value, model);
  return schema ? fit(schema, profile.profile.value.settings).settings : profile.profile.value.settings;
}

// A model's context limit and reply length: the ones its 묶음 sets, else its catalog's.
const contextOf = (model: Starred, settings: ModelSettings | null) => settings?.context ?? model.contextLength;
const replyOf = (model: Starred, settings: ModelSettings | null) => settings?.maxOutput ?? model.maxOutput;

function botModel(route: Route, settings: ModelSettings | null): ChatScope['model'] {
  const { connection, model } = route;
  return { id: model.id, maxContext: contextOf(model, settings), prefill: modelSettings(connection.value, model)?.prefill ?? null };
}

// What the prompt may take of the model's context. A reply length nobody knows reserves nothing.
function budgetOf(model: Starred, settings: ModelSettings | null): number | null {
  const context = contextOf(model, settings);
  return context === null ? null : context - (replyOf(model, settings) ?? 0);
}

// What a chat's prompt may take of its 대화 모델's context; null when it has none or the context is unknown.
export function promptBudget(store: Reader['store'], chat: Chat): number | null {
  const route = chatModel(store, chat, 'main');
  return 'kind' in route ? null : budgetOf(route.model, sentSettings(store, route));
}

// A chat's messages as a request sends them: under 반전 모드, each with its shown version's translation as its text.
export const asSent = (store: Reader['store'], chat: Chat, messages: Message[]) => (translateSwitches(store, chat.character).reverse ? messages.map(reversed) : messages);

// Each message's text as the chat shows it, for its log, its title and its preview, and the bot's CSS for its log.
// screen: the window the chat is shown in, for a bot's layout; null for what is not shown, such as a preview.
export const displayChat = (reader: Reader, id: string | null, chat: Chat, messages: Message[], screen: ChatScope['screen'] = null, clock?: ChatScope['clock']): Display =>
  display({ ...scopeOf(reader, id, chat, messages), screen, ...(clock && { clock }) }, pinned(reader, chat));

// The status window's scripts (상태창 지정), whose boxes leave every message and what is translated of it, unless
// 봇 꾸밈 is off; the chat draws the latest box itself.
export function pinned({ store }: Reader, chat: Chat): ReadonlySet<number> {
  const character = chat.character === null ? null : store.get('character', chat.character)?.value;
  return new Set(character?.decor === false ? [] : (character?.statusScripts ?? []));
}

// The status window: each of its scripts' box from the latest message that drew one, with that message's place. A
// reply still being written is passed over, since half a box would show; so is a box its script left empty, as bots
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

// What a translation in this chat is made from: one of messages, or the user's message after them.
export function translationInput(reader: Reader, id: string, chat: Chat, messages: Message[], request: TranslationRequest): TranslateInput {
  return { chat, scope: scopeOf(reader, id, chat, messages), take: pinned(reader, chat), translations: messages.map((message) => shown(message).translation?.text ?? null), request };
}

// An unsaved chat is read from its open screen, the only place it exists.
export function translateLatest(session: Pick<Session, 'store' | 'read' | 'talk' | 'translator'>, id: string) {
  const view = session.read.displayed(id);
  if (!view) return;
  const { chat } = view;
  if ( !translateSwitches(session.store, chat.character).replies) return;
  const messages = withTurn(view.messages, session.talk.snapshot(), id);
  const last = messages.at(-1);
  if (!last || last.role !== 'assistant' || last.live !== null) return;
  const version = shown(last);
  const { live, failed } = session.translator.snapshot();
  if (version.receipt?.state === 'failed' || version.translation || live.has(version.id) || failed.has(version.id)) return;
  if (!view.display.texts.at(-1)!.trim()) return;
  session.translator.translate(id, version, translationInput(session, id, chat, messages, { kind: 'message', index: messages.length - 1 }));
}

// A scope a turn can send from, or why not.
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
  const stored = session.store.get('chat', chat);
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

// The request the chat would send for target now; null while it cannot send, or the prompt is over the model's budget.
export type Sending = { turn: TurnContext; prompt: Assembled };

export function wouldSend(session: Pick<Session, 'store' | 'read'>, chat: string, target: Target, countTokens: (text: string) => number): Sending | null {
  const turn = gatherTurn(session, chat, target);
  if (turn === null || 'kind' in turn) return null;
  const prompt = assemble({ scope: turn.scope, seed: turn.reply.id, countTokens, budget: turn.budget, continuing: false, memory: turn.memory });
  return 'kind' in prompt ? null : { turn, prompt };
}

// A request as its cache reads it, for the forecast beside the send button.
export function cacheSend({ turn, prompt }: Sending): CacheSend | null {
  const view = cacheViewOf(turn.route.connection.value, turn.route.model, turn.settings, prompt.messages);
  return view && { connection: turn.route.connection.id, view, parts: prompt.parts };
}

// A message whose shown version has a translation, with that translation as its text: a reply's, or what the user
// typed for a message sent translated.
function reversed(message: Message): Message {
  const version = shown(message);
  return version.translation ? { ...message, versions: message.versions.with(message.selected, { ...version, text: version.translation.text }) } : message;
}

// start: the new chat to save first, which the turn is shown in while it is saved; started runs once it is.
export function takeTurn(session: Session, chat: string, target: Target, start: { chat: Chat; greetings: Greetings | null; started: () => void } | null = null): Promise<TurnFailure | null> {
  if (start) {
    const ids = { said: crypto.randomUUID(), reply: crypto.randomUUID() };
    const said = target.kind === 'send' ? { id: ids.said, text: target.text } : null;
    const again = (answer: boolean) => gatherTurn(session, chat, answer ? { kind: 'answer' } : target, ids);
    return unhalted(session.talk.run({ chat, said, reply: { id: ids.reply, message: null, replaces: null, continues: null } }, async (signal) => {
      const unstarted = await startChat(session.store, chat, start.chat, start.greetings);
      if (unstarted) return { kind: 'unstarted', failure: unstarted };
      start.started();
      // The chat was just saved and a new chat's target names no message, so it is there.
      const turn = gatherTurn(session, chat, target, ids)!;
      return 'kind' in turn ? turn : prepare(session, chat, turn, signal, again);
    }));
  }
  const lease = session.store.retainChat(chat);
  const send = (): Promise<TurnFailure | null> => {
    const ids = { said: crypto.randomUUID(), reply: crypto.randomUUID() };
    const showing = gatherTurn(session, chat, target, ids);
    if (showing === null || 'kind' in showing) return Promise.resolve(showing);
    const again = (answer: boolean) => gatherTurn(session, chat, answer ? { kind: 'answer' } : target, ids);
    return unhalted(session.talk.run({ chat, said: showing.said, reply: showing.reply }, async (signal) => {
      // Another device may have written to this chat while this page stood open without focus or a timer's pull, so the
      // prompt is gathered again after a pull. A turn it cannot pull does not send on what may be stale.
      const unpulled = await session.store.pull();
      if (unpulled) return { kind: 'unpulled', failure: unpulled };
      const turn = gatherTurn(session, chat, target, ids);
      if (turn === null) return { kind: 'gone' };
      return 'kind' in turn ? turn : prepare(session, chat, turn, signal, again);
    }));
  };
  const sending = session.store.scopeState(chat) === 'loaded' ? send() : lease.ready.then((failure): Promise<TurnFailure | null> => failure ? Promise.resolve({ kind: 'unpulled', failure }) : send());
  return sending.finally(lease.release);
}

// A turn the bot's Lua ended before any request (stopChat) is not a failure: the user's message stays, and nothing
// is said of it.
const unhalted = (turn: Promise<TurnFailure | Halted | null>): Promise<TurnFailure | null> => turn.then((failure) => (failure?.kind === 'halted' ? null : failure));

// again: the turn gathered anew, once the bot's Lua has changed the chat under it (Scripts.starting).
async function prepare(session: Session, chat: string, gathered: TurnContext, signal: AbortSignal, again: (answer: boolean) => TurnContext | Blocked | null): Promise<Ask | Halted | TurnFailure> {
  const translated = gathered.said && translateSwitches(session.store, gathered.chat.character).input ? await sendTranslated(session, chat, gathered, signal) : gathered;
  if ('kind' in translated) return translated;
  const started = await session.scripts.starting(chat, translated, again, signal);
  if ('kind' in started) return started;
  const { route, settings, scope, budget, memory, said, reply } = started.turn;
  const kept = translated.said !== null && said === null ? { kept: true as const } : {};
  const countTokens = await tokenizer().catch(() => null);
  if (!countTokens) return { kind: 'tokenizer', ...kept };
  const prompt = assemble({ scope, seed: reply.id, countTokens, budget, continuing: reply.continues !== null, memory });
  if ('kind' in prompt) return { ...prompt, ...kept };
  const requested = await session.scripts.requesting(chat, started.turn, prompt.messages);
  const sent = requested.messages === prompt.messages ? prompt : rewritten(prompt, requested.messages, countTokens, budget);
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
