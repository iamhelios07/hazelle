import type { Cost } from '../connectors/types';
import { shown, type Chat, type Entry, type Message, type Receipt } from '../model/chat';
import type { Stored } from '../model/kinds';
import type { ApiFailure, ApiResult } from './api';
import type { ObjectStore } from './store';

// The only writer of `chat` and `entry` objects (tech-spec §5), except a chat's `models` layer, which
// runtime/assignment writes with the other layers, and a character's purge (runtime/characters), which
// removes them with the character.

// A new chat is saved in this order: the chat, then its greetings with the one shown selected, then
// the user's first message (runtime/turn, sent with its reply). Messages stand in the order they were
// saved (model/chat fold), so the greeting leads only when it is saved before the message; and a chat
// that failed to save leaves no entries behind.
export async function startChat(
  store: ObjectStore,
  chat: Chat,
  greetings: { texts: string[]; selected: number } | null,
): Promise<{ ok: true; id: string } | { ok: false; step: 'chat' | 'greetings'; failure: ApiFailure }> {
  const created = await store.create('chat', chat);
  if (!created.ok) return { ok: false, step: 'chat', failure: created };
  const id = created.data.id;
  const greeted = greetings && (await addGreetings(store, id, greetings.texts, greetings.selected));
  return greeted ? { ok: false, step: 'greetings', failure: greeted } : { ok: true, id };
}

// A character's chat opens on its greeting, and the other greetings are versions of it (design F3).
// They are saved as the card wrote them; engine/render fills them each time they are shown or sent.
async function addGreetings(store: ObjectStore, chat: string, texts: string[], selected: number): Promise<ApiFailure | null> {
  const at = Date.now();
  const ids = texts.map(() => crypto.randomUUID());
  const first = ids[0]!;
  const entries: [string, Entry][] = texts.map((text, index) => [
    ids[index]!,
    index === 0 ? { type: 'message', role: 'assistant', at, text, receipt: null } : { type: 'version', message: first, replaces: null, edit: false, at, text, receipt: null },
  ]);
  // Adding a version selects it, so without a select the chat would open on the last greeting.
  if (selected !== texts.length - 1) entries.push([crypto.randomUUID(), { type: 'select', message: first, version: ids[selected]!, at }]);
  for (const [id, entry] of entries) {
    const saved = await store.create('entry', entry, { id, parent: chat });
    if (!saved.ok) return saved;
  }
  return null;
}

// A blank name gives the chat back its first message as its name (model/chat chatTitle).
export const renameChat = (store: ObjectStore, id: string, name: string) => store.update('chat', id, (current) => ({ ...current, title: name.trim() || null }));

// Removes the chat object only. Its entries stay, unreachable, so restoreChat (되돌리기) brings back all of it.
export async function removeChat(store: ObjectStore, id: string): Promise<ApiResult<Stored<'chat'>>> {
  const chat = store.get('chat', id);
  if (!chat) return { ok: false, error: 'gone' };
  const removed = await store.remove(id);
  return removed.ok ? { ok: true, data: chat } : removed;
}

export const restoreChat = (store: ObjectStore, removed: Stored<'chat'>) => store.restore(removed);

// A chat's own prompt, persona or 작가의 노트; null clears it, and the chat follows the default again
// (design §4.2, §4.3).
function setOwn(store: ObjectStore, chat: string, field: 'prompt' | 'persona' | 'note', value: string | null): Promise<ApiResult<Stored<'chat'>>> {
  return store.update('chat', chat, (current) => {
    const next = { ...current };
    if (value === null) delete next[field];
    else next[field] = value;
    return next;
  });
}

export const setChatPrompt = (store: ObjectStore, chat: string, prompt: string | null) => setOwn(store, chat, 'prompt', prompt);

export const setChatPersona = (store: ObjectStore, chat: string, persona: string | null) => setOwn(store, chat, 'persona', persona);

export const setChatNote = (store: ObjectStore, chat: string, note: string | null) => setOwn(store, chat, 'note', note);

const append = (store: ObjectStore, chat: string, entry: Entry, id?: string) => store.create('entry', entry, { id, parent: chat });

export const appendUserMessage = (store: ObjectStore, chat: string, { id, text }: { id: string; text: string }) =>
  append(store, chat, { type: 'message', role: 'user', at: Date.now(), text, receipt: null }, id);

// A reply as its stream ended: a new message, or a new version of `message`, in place of `replaces` on
// 다시 시도. at is the reply's own, never the time of the save, so saving it again (Talk.saveAgain)
// sends the same entry, and a first try that landed unanswered is found as it is (runtime/store create).
export type Written = { id: string; message: string | null; replaces: string | null; at: number; text: string; receipt: Receipt };

export function appendReply(store: ObjectStore, chat: string, { id, message, replaces, at, text, receipt }: Written) {
  return append(store, chat, message === null ? { type: 'message', role: 'assistant', at, text, receipt } : { type: 'version', message, replaces, edit: false, at, text, receipt }, id);
}

export const appendCost = (store: ObjectStore, chat: string, replyId: string, cost: Cost | null) => append(store, chat, { type: 'cost', replyId, cost, at: Date.now() });

// An edit is a new version in the place of the one shown, keeping its receipt (model/chat Entry).
export function editMessage(store: ObjectStore, chat: string, message: Message, text: string) {
  const current = shown(message);
  return append(store, chat, { type: 'version', message: message.id, replaces: current.id, edit: true, at: Date.now(), text, receipt: current.receipt });
}

export const selectVersion = (store: ObjectStore, chat: string, message: string, version: string) => append(store, chat, { type: 'select', message, version, at: Date.now() });

export const removeMessage = (store: ObjectStore, chat: string, message: string) => append(store, chat, { type: 'delete', message, at: Date.now() });

export const restoreMessage = (store: ObjectStore, chat: string, message: string) => append(store, chat, { type: 'restore', message, at: Date.now() });
