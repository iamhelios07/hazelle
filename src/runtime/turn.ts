import { buildPrompt, type PromptInput } from '../engine/pipeline';
import type { Scope } from '../engine/render';
import { fold, shown, type Chat } from '../model/chat';
import { chatModel, type RouteFailure } from './assignment';
import type { Session } from './session';
import type { Ask, TalkFailure, Turn } from './talk';

// What the user asks for: their new message and a reply to it, a reply to the last message sending
// nothing new (답장 받기), another version of a reply (다시 생성), or one in place of a failed version
// (다시 시도).
export type Target =
  | { kind: 'send'; text: string }
  | { kind: 'answer' }
  | { kind: 'regenerate'; message: string }
  | { kind: 'retry'; message: string; version: string };

// Everything one reply needs, read once when it is asked for: the model, what the prompt is built from
// (the user's new message last in its history), the message Talk saves with the reply, and where the reply goes.
export type TurnContext = PromptInput & Omit<Ask, 'chat' | 'prompt'>;

// Who a chat's text names (engine/render). The account's username stands in for {{user}} until
// personas exist (design F3).
export function scopeOf({ store, username }: Pick<Session, 'store' | 'username'>, chat: Chat): Scope {
  const character = chat.character === null ? null : store.get('character', chat.character);
  return { card: character?.value.card ?? null, user: username };
}

// null: the chat, or the message the target names, is gone.
export function gatherTurn(session: Session, chat: string, target: Target): TurnContext | RouteFailure | null {
  const stored = session.store.get('chat', chat);
  if (!stored) return null;
  const route = chatModel(session.store, stored.value);
  if ('kind' in route) return route;

  const messages = fold(session.store.children('entry', chat));
  const message = target.kind === 'regenerate' || target.kind === 'retry' ? target.message : null;
  const at = message === null ? messages.length : messages.findIndex((candidate) => candidate.id === message);
  if (at === -1) return null;
  const said: Turn['said'] = target.kind === 'send' ? { id: crypto.randomUUID(), text: target.text } : null;
  const history = messages.slice(0, at).map((before) => ({ role: before.role, text: shown(before).text }));
  return {
    route,
    scope: scopeOf(session, stored.value),
    history: said ? [...history, { role: 'user', text: said.text }] : history,
    said,
    reply: { message, replaces: target.kind === 'retry' ? target.version : null },
  };
}

export function takeTurn(session: Session, chat: string, target: Target): Promise<TalkFailure | null> {
  const turn = gatherTurn(session, chat, target);
  if (turn === null || 'kind' in turn) return Promise.resolve(turn);
  return session.talk.run({ chat, route: turn.route, prompt: buildPrompt(turn), said: turn.said, reply: turn.reply });
}
