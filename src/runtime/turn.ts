import { modelSettings } from '../connectors/registry';
import { fit, type ModelSettings } from '../connectors/settings';
import type { Starred } from '../connectors/types';
import type { Card } from '../engine/import/types';
import { readToggles } from '../engine/import/toggles';
import { assemble, type PromptInput, type TooLong } from '../engine/pipeline';
import { renderChat, type ChatScope } from '../engine/render';
import { fold, shown, type Chat, type Message } from '../model/chat';
import type { Toggle } from '../model/prompt';
import { SETTINGS_ID } from '../model/settings';
import { chatToggles, toggleValue } from '../model/toggles';
import { chatModel, type Route, type RouteFailure } from './assignment';
import { chatPersona } from './personas';
import { modelProfile } from './profiles';
import { chatPrompt, type PromptChoice } from './prompts';
import type { Session } from './session';
import type { ApiFailure } from './api';
import { startChat } from './chat-log';
import type { Ask, TalkFailure, Turn } from './talk';

// What the user asks for: their new message and a reply to it, a reply to the last message sending
// nothing new (답장 받기), another version of a reply (다시 생성), one in place of a failed version
// (다시 시도), or the rest of a cut version, which takes its place (이어 쓰기).
export type Target =
  | { kind: 'send'; text: string }
  | { kind: 'answer' }
  | { kind: 'regenerate'; message: string }
  | { kind: 'retry'; message: string; version: string }
  | { kind: 'continue'; message: string; version: string };

// Why a chat cannot start a turn: no model, or its prompt, persona or its model's 설정 묶음 is missing (design §4.2,
// §4.3, §4.4); own says whether the missing one was the chat's (the model's) own or the default.
export type Blocked = RouteFailure | { kind: 'prompt-missing'; own: boolean } | { kind: 'persona-missing'; own: boolean } | { kind: 'profile-missing'; own: boolean };
// A turn also stops before sending on a new chat that was not saved, a tokenizer that did not load, or a prompt
// over the model's budget.
export type TurnFailure = TalkFailure | Blocked | TooLong | { kind: 'tokenizer' } | { kind: 'unstarted'; step: 'chat' | 'greetings'; failure: ApiFailure };

// Everything one reply needs, read once when it is asked for: the model, what the prompt is built from (the
// user's new message last in its messages), the message Talk saves with the reply, and where the reply goes.
export type TurnContext = Pick<Ask, 'route' | 'settings'> & Pick<Turn, 'said' | 'reply'> & Pick<PromptInput, 'scope' | 'budget'>;

type Reader = Pick<Session, 'store'>;

// What a chat's text is rendered with, on screen and in a turn: its character's card, lore and toggle values,
// its prompt, persona and note, and the model it talks to. id is null for a chat not saved yet.
export function scopeOf({ store }: Reader, id: string | null, chat: Chat, messages: Message[]): ChatScope {
  const character = chat.character === null ? null : (store.get('character', chat.character)?.value ?? null);
  const card = character?.card ?? null;
  const prompt = chatPrompt(store, chat);
  const persona = chatPersona(store, chat);
  const route = chatModel(store, chat);
  return {
    card,
    persona: persona.kind === 'persona' ? { name: persona.persona.value.name, description: persona.persona.value.description } : null,
    prompt: prompt.kind === 'prompt' ? prompt.prompt.value : null,
    note: chat.note ?? null,
    lore: chat.character === null ? [] : store.children('lore', chat.character),
    messages: messages.map((message) => {
      const version = shown(message);
      return { id: version.id, seed: version.seed, role: message.role, text: version.text, time: version.at };
    }),
    greeting: card && greetingOf(card, messages),
    toggle: togglesOf(store, chat, prompt).value,
    model: 'kind' in route ? null : botModel(route, sentSettings(store, route)),
    clock: { now: Date.now(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    pick: `${chat.character ?? ''}:${chat.seed ?? id ?? ''}`,
  };
}

export type ChatToggleSet = { declared: Toggle[]; value: (key: string) => string | null };

// A chat's toggles and their values (design §4.2): what its turns send with, and what its toggle panel lists.
export function togglesOf(store: Session['store'], chat: Chat, prompt: PromptChoice): ChatToggleSet {
  const character = chat.character === null ? null : (store.get('character', chat.character)?.value ?? null);
  const declared = chatToggles(prompt.kind === 'prompt' ? prompt.prompt.value.toggles : [], character ? readToggles(character.card.toggles).toggles : []);
  return { declared, value: toggleValue(declared, (character ? character.toggles : store.get('settings', SETTINGS_ID)?.value.toggles) ?? {}) };
}

// A chat's greeting is its first message when that is an assistant message the model did not write (tech-spec
// §5). Its index in the card is that of the shown version among the card's greetings that are not blank, which
// are the ones a chat saves.
function greetingOf(card: Card, messages: Message[]): ChatScope['greeting'] {
  const first = messages[0];
  if (first?.role !== 'assistant' || first.versions[0]!.receipt !== null) return null;
  const greetings = card.greetings.flatMap((text, index) => (text.trim() ? [index] : []));
  return { index: shown(first).receipt === null ? (greetings[first.selected] ?? null) : null };
}

// The 묶음's settings as this model is sent them (design §4.4); null while its 묶음 is missing, which a turn stops on.
function sentSettings(store: Reader['store'], { connection, model }: Route): ModelSettings | null {
  const profile = modelProfile(store, model);
  if (profile.kind === 'missing') return null;
  const schema = modelSettings(connection.value, model);
  return schema ? fit(schema, profile.profile.value.settings).settings : profile.profile.value.settings;
}

// A model's context limit and reply length: the ones its 묶음 sets, else its catalog's (design §4.4).
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

// Each message's text as the chat shows it, for its log, its title and its preview.
export const displayChat = (reader: Reader, id: string | null, chat: Chat, messages: Message[]) => renderChat('display', scopeOf(reader, id, chat, messages)).texts;

// A scope a turn can send from, or why not.
function sendable(scope: ChatScope, chat: Chat): PromptInput['scope'] | Blocked {
  const { prompt, persona } = scope;
  if (!prompt) return { kind: 'prompt-missing', own: chat.prompt !== undefined };
  if (!persona) return { kind: 'persona-missing', own: chat.persona !== undefined };
  return { ...scope, prompt, persona };
}

// null: nothing stops the chat from starting a turn. The screen asks before it saves a new chat.
export function blocked(reader: Reader, chat: Chat): Blocked | null {
  const route = chatModel(reader.store, chat);
  if ('kind' in route) return route;
  const profile = modelProfile(reader.store, route.model);
  if (profile.kind === 'missing') return { kind: 'profile-missing', own: profile.own };
  const scope = sendable(scopeOf(reader, null, chat, []), chat);
  return 'kind' in scope ? scope : null;
}

// null: the chat, or the message the target names, is gone; for a continue, so is the version it names. ids are
// the ones the turn was shown under, for a new chat shown before it was saved.
export function gatherTurn(session: Session, chat: string, target: Target, ids = { said: crypto.randomUUID(), reply: crypto.randomUUID() }): TurnContext | Blocked | null {
  const stored = session.store.get('chat', chat);
  if (!stored) return null;
  const route = chatModel(session.store, stored.value);
  if ('kind' in route) return route;
  const profile = modelProfile(session.store, route.model);
  if (profile.kind === 'missing') return { kind: 'profile-missing', own: profile.own };
  const { settings } = profile.profile.value;

  const messages = fold(session.store.children('entry', chat));
  const message = 'message' in target ? target.message : null;
  const at = message === null ? messages.length : messages.findIndex((candidate) => candidate.id === message);
  if (at === -1) return null;
  const index = 'version' in target ? messages[at]!.versions.findIndex((version) => version.id === target.version) : -1;
  const version = messages[at]?.versions[index];
  // 이어 쓰기 continues the version it names. So does 다시 시도 on a continuation that failed, so that neither the text
  // it continues nor the calls its receipt carries are dropped.
  const continues = version?.receipt && (target.kind === 'continue' || version.receipt.continues) ? { text: version.text, receipt: version.receipt, seed: version.seed } : null;
  if (target.kind === 'continue' && !continues) return null;
  const said: Turn['said'] = target.kind === 'send' ? { id: ids.said, text: target.text } : null;
  const now = Date.now();
  const sending: Message[] = said ? [{ id: said.id, role: 'user', at: now, versions: [{ id: said.id, seed: said.id, text: said.text, receipt: null, edited: false, at: now }], selected: 0 }] : [];
  // A continuation's prompt ends with the version it continues.
  const history = continues ? [...messages.slice(0, at), { ...messages[at]!, selected: index }] : [...messages.slice(0, at), ...sending];
  const scope = sendable(scopeOf(session, chat, stored.value, history), stored.value);
  if ('kind' in scope) return scope;
  return { route, settings, scope, budget: budgetOf(route.model, sentSettings(session.store, route)), said, reply: { id: ids.reply, message, replaces: 'version' in target ? target.version : null, continues } };
}

// o200k_base counts for every model (tech-spec §8), loaded when a chat opens rather than with the page. Text
// that spells a special token counts as text.
const tokenizer = () => import('gpt-tokenizer/encoding/o200k_base').then(({ countTokens }) => (text: string) => countTokens(text, { disallowedSpecial: new Set() }));

// A load that fails here is reported by the send that needs it.
export const preloadTokenizer = () => void tokenizer().catch(() => {});

// start: the new chat to save first, which the turn is shown in while it is saved; started runs once it is.
export function takeTurn(session: Session, chat: string, target: Target, start: { chat: Chat; greetings: Parameters<typeof startChat>[3]; started: () => void } | null = null): Promise<TurnFailure | null> {
  if (start) {
    const ids = { said: crypto.randomUUID(), reply: crypto.randomUUID() };
    const said = target.kind === 'send' ? { id: ids.said, text: target.text } : null;
    return session.talk.run({ chat, said, reply: { id: ids.reply, message: null, replaces: null, continues: null } }, async () => {
      const started = await startChat(session.store, chat, start.chat, start.greetings);
      if (!started.ok) return { kind: 'unstarted', step: started.step, failure: started.failure };
      start.started();
      // The chat was just saved and a new chat's target names no message, so it is there.
      const turn = gatherTurn(session, chat, target, ids)!;
      return 'kind' in turn ? turn : prepare(turn);
    });
  }
  const turn = gatherTurn(session, chat, target);
  if (turn === null || 'kind' in turn) return Promise.resolve(turn);
  return session.talk.run({ chat, said: turn.said, reply: turn.reply }, () => prepare(turn));
}

async function prepare(turn: TurnContext): Promise<Ask | TooLong | { kind: 'tokenizer' }> {
  const countTokens = await tokenizer().catch(() => null);
  if (!countTokens) return { kind: 'tokenizer' };
  const { route, settings, scope, budget, reply } = turn;
  const prompt = assemble({ scope, seed: reply.id, countTokens, budget, continuing: reply.continues !== null });
  return 'kind' in prompt ? prompt : { route, settings, prompt };
}
