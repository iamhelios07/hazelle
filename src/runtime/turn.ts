import { modelSettings } from '../connectors/registry';
import type { Starred } from '../connectors/types';
import type { Card } from '../engine/import/types';
import { readToggles } from '../engine/import/toggles';
import { assemble, type PromptInput, type TooLong } from '../engine/pipeline';
import { renderChat, type ChatScope } from '../engine/render';
import { fold, shown, type Chat, type Message } from '../model/chat';
import type { Stored } from '../model/kinds';
import { SETTINGS_ID } from '../model/settings';
import { chatToggles, toggleValue } from '../model/toggles';
import { chatModel, type Route, type RouteFailure } from './assignment';
import { chatPersona } from './personas';
import { chatPrompt } from './prompts';
import type { Session } from './session';
import type { Ask, TalkFailure } from './talk';

// What the user asks for: their new message and a reply to it, a reply to the last message sending
// nothing new (답장 받기), another version of a reply (다시 생성), or one in place of a failed version
// (다시 시도).
export type Target =
  | { kind: 'send'; text: string }
  | { kind: 'answer' }
  | { kind: 'regenerate'; message: string }
  | { kind: 'retry'; message: string; version: string };

// Why a chat cannot start a turn: no model, or its prompt or persona is missing (design §4.2, §4.3); own says
// whether the missing one was the chat's own or the default.
export type Blocked = RouteFailure | { kind: 'prompt-missing'; own: boolean } | { kind: 'persona-missing'; own: boolean };
// A turn also stops before sending on a tokenizer that did not load, or a prompt over the model's budget.
export type TurnFailure = TalkFailure | Blocked | TooLong | { kind: 'tokenizer' };

// Everything one reply needs, read once when it is asked for: the model, what the prompt is built from (the
// user's new message last in its messages), the message Talk saves with the reply, and where the reply goes.
export type TurnContext = { route: Route } & Pick<PromptInput, 'scope' | 'budget'> & Pick<Ask, 'said' | 'reply'>;

type Reader = Pick<Session, 'store'>;

// What a chat's text is rendered with, on screen and in a turn: its character's card, lore and toggle values,
// its prompt, persona and note, and the model it talks to. id is null for a chat not saved yet.
export function scopeOf({ store }: Reader, id: string | null, chat: Chat, messages: Message[]): ChatScope {
  const character = chat.character === null ? null : (store.get('character', chat.character)?.value ?? null);
  const card = character?.card ?? null;
  const prompt = chatPrompt(store, chat);
  const persona = chatPersona(store, chat);
  const route = chatModel(store, chat);
  const declared = chatToggles(prompt.kind === 'prompt' ? prompt.prompt.value.toggles : [], card ? readToggles(card.toggles).toggles : []);
  return {
    card,
    persona: persona.kind === 'persona' ? { name: persona.persona.value.name, description: persona.persona.value.description } : null,
    prompt: prompt.kind === 'prompt' ? prompt.prompt.value : null,
    note: chat.note ?? null,
    lore: chat.character === null ? [] : store.children('lore', chat.character),
    messages: messages.map((message) => {
      const version = shown(message);
      return { id: version.id, role: message.role, text: version.text, time: version.at };
    }),
    greeting: card && greetingOf(card, messages),
    toggle: toggleValue(declared, (character ? character.toggles : store.get('settings', SETTINGS_ID)?.value.toggles) ?? {}),
    model: 'kind' in route ? null : botModel(route),
    clock: { now: Date.now(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    pick: `${chat.character ?? ''}:${id ?? ''}`,
  };
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

// A model's context limit and reply length: the ones set for it, else its catalog's (design §4.4).
const contextOf = (model: Starred) => model.settings?.context ?? model.contextLength;
const replyOf = (model: Starred) => model.settings?.maxOutput ?? model.maxOutput;

function botModel({ connection, model }: { connection: Stored<'connection'>; model: Starred }): ChatScope['model'] {
  return { id: model.id, maxContext: contextOf(model), prefill: modelSettings(connection.value, model)?.prefill ?? null };
}

// What the prompt may take of the model's context. A reply length nobody knows reserves nothing.
function budgetOf(model: Starred): number | null {
  const context = contextOf(model);
  return context === null ? null : context - (replyOf(model) ?? 0);
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
  const scope = sendable(scopeOf(reader, null, chat, []), chat);
  return 'kind' in scope ? scope : null;
}

// null: the chat, or the message the target names, is gone.
export function gatherTurn(session: Session, chat: string, target: Target): TurnContext | Blocked | null {
  const stored = session.store.get('chat', chat);
  if (!stored) return null;
  const route = chatModel(session.store, stored.value);
  if ('kind' in route) return route;

  const messages = fold(session.store.children('entry', chat));
  const message = target.kind === 'regenerate' || target.kind === 'retry' ? target.message : null;
  const at = message === null ? messages.length : messages.findIndex((candidate) => candidate.id === message);
  if (at === -1) return null;
  const said: Ask['said'] = target.kind === 'send' ? { id: crypto.randomUUID(), text: target.text } : null;
  const now = Date.now();
  const sending: Message[] = said ? [{ id: said.id, role: 'user', at: now, versions: [{ id: said.id, text: said.text, receipt: null, edited: false, at: now }], selected: 0 }] : [];
  const scope = sendable(scopeOf(session, chat, stored.value, [...messages.slice(0, at), ...sending]), stored.value);
  if ('kind' in scope) return scope;
  return { route, scope, budget: budgetOf(route.model), said, reply: { id: crypto.randomUUID(), message, replaces: target.kind === 'retry' ? target.version : null } };
}

// o200k_base counts for every model (tech-spec §8), loaded with the first send rather than with the page. Text
// that spells a special token counts as text.
const tokenizer = () => import('gpt-tokenizer/encoding/o200k_base').then(({ countTokens }) => (text: string) => countTokens(text, { disallowedSpecial: new Set() }));

export async function takeTurn(session: Session, chat: string, target: Target): Promise<TurnFailure | null> {
  const turn = gatherTurn(session, chat, target);
  if (turn === null || 'kind' in turn) return turn;
  const countTokens = await tokenizer().catch(() => null);
  if (!countTokens) return { kind: 'tokenizer' };
  const { route, scope, budget, said, reply } = turn;
  const prompt = assemble({ scope, seed: reply.id, countTokens, budget });
  if ('kind' in prompt) return prompt;
  return session.talk.run({ chat, route, prompt, said, reply });
}
