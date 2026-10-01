import type { Cost } from '../connectors/types';
import { shown, type Chat, type ChatItem, type Entry, type Message, type Receipt, type Translation } from '../model/chat';
import type { Stored } from '../model/kinds';
import { memoryId, type Memory, type Source } from '../model/memory';
import type { ApiFailure, ApiResult } from './api';
import { without, type ObjectStore, type Write } from './store';

// The only writer of `chat` and `entry` objects, except a chat's `models` layer, which runtime/assignment
// writes with the other layers, a character's purge, which removes them with the character, and a backup's
// restore, which copies them as they were.

// A new chat is saved in this order: the chat with its greetings, the one shown selected, then the user's first
// message, sent with its reply. Messages stand in the order they were saved, so the greeting leads only when it is
// saved before the message. The chat and its greetings are one batch, which writes the greetings first, so the
// chat is never there without them: its screen would show it greeting-less until they landed.
// id is the one the chat was shown under before it was saved, which seeds its greeting's pick and rollp tags.
export async function startChat(store: ObjectStore, id: string, chat: Chat, greetings: Greetings | null): Promise<ApiFailure | null> {
  const saved = await store.batch([...(greetings ? greetingWrites(id, greetings) : []), { type: 'create', kind: 'chat', id, parent: null, value: chat }]);
  return saved.ok ? null : saved;
}

// ids are the ones the greetings were shown under before the chat was saved, which seed their random tags.
// translations: those made before the chat was saved, by the greeting's id.
export type Greetings = { ids: string[]; texts: string[]; selected: number; translations: ReadonlyMap<string, Translation> };

// A character's chat opens on its greeting, and the other greetings are versions of it. They are saved as the card wrote them; engine/render fills them each time they are shown or sent.
function greetingWrites(chat: string, { ids, texts, selected, translations }: Greetings): Write[] {
  const at = Date.now();
  const first = ids[0]!;
  const entries: [string, Entry][] = texts.map((text, index) => {
    const translation = translations.get(ids[index]!);
    const common = { at, text, receipt: null, ...(translation && { translation }) };
    return [ids[index]!, index === 0 ? { type: 'message', role: 'assistant', ...common } : { type: 'version', message: first, replaces: null, edit: false, ...common }];
  });
  // Adding a version selects it, so without a select the chat would open on the last greeting.
  if (selected !== texts.length - 1) entries.push([crypto.randomUUID(), { type: 'select', message: first, version: ids[selected]!, at }]);
  return entries.map(([id, value]) => ({ type: 'create', kind: 'entry', id, parent: chat, value }));
}

// 갈라지기: a new chat holding item's messages up to and including message, as they fold, and the memory of them. The
// spread takes the original's own choices; nothing links the two chats but origin, so deleting either leaves the other
// whole.
export async function branchChat(store: ObjectStore, item: ChatItem, message: string): Promise<ApiResult<string>> {
  const upTo = item.messages.findIndex((candidate) => candidate.id === message);
  if (upTo === -1) return { ok: false, error: 'gone' };
  const id = crypto.randomUUID();
  let after = '';
  const writes: Write[] = [];
  const messages = new Map<string, string>();
  const versions = new Map<string, string>();
  for (const source of item.messages.slice(0, upTo + 1)) {
    after = crypto.randomUUID();
    messages.set(source.id, after);
    const copy = copied(after, source);
    for (const [old, made] of copy.versions) versions.set(old, made);
    for (const [entryId, entry] of copy.entries) {
      writes.push({ type: 'create', kind: 'entry', id: entryId, parent: id, value: entry });
    }
  }
  const memory = store.get('memory', memoryId(item.id))?.value;
  const kept = memory && branchMemory(memory, messages, versions);
  if (kept) writes.push({ type: 'create', kind: 'memory', id: memoryId(id), parent: id, value: kept });
  writes.push({ type: 'create', kind: 'chat', id, parent: null, value: { ...item.chat, title: null, origin: { id: item.id, name: item.title, after }, seed: item.chat.seed ?? item.id } });
  const created = await store.batch(writes);
  return created.ok ? { ok: true, data: id } : created;
}

// The records whose every message lies before the split, their sources remapped to the branch's messages and versions
// (a version the branch does not hold keeps its old id, so the record stays stale there too), with the facts and threads
// they or the user set. A record across the split stays behind, and its messages stay raw in the branch until its own
// summarizing reaches them. null: nothing to carry.
function branchMemory(memory: Memory, messages: ReadonlyMap<string, string>, versions: ReadonlyMap<string, string>): Memory | null {
  const remap = ({ message, version }: Source): Source => ({ message: messages.get(message)!, version: versions.get(version) ?? version });
  const records = memory.records.filter(({ sources }) => sources.every(({ message }) => messages.has(message))).map((record) => ({ ...record, sources: record.sources.map(remap) }));
  const carried = new Set(records.map(({ id }) => id));
  const state = memory.state.filter(({ record }) => record === null || carried.has(record));
  const threads = memory.threads.filter(({ opened }) => opened === null || carried.has(opened));
  return records.length || state.length || threads.length ? { records, state, threads } : null;
}

// The entries that fold back to message under the id given: its first version as the message entry, and that
// version again in its own place when it is an edit or came later than the message, which a message entry cannot
// hold; the other versions; and a select when the one shown is not the last, since adding a version selects it.
// versions: each version's id in the branch, by its id here.
// A field added to versions or messages must be written here too, or a branch drops it.
function copied(id: string, { role, at, versions, selected }: Message): { entries: [string, Entry][]; versions: Map<string, string> } {
  const ids = versions.map((_, index) => (index === 0 ? id : crypto.randomUUID()));
  const [first, ...rest] = versions;
  const held = ({ text, receipt, seed, translation }: Message['versions'][number]) => ({ text, receipt, seed, ...(translation && { translation }) });
  const entries: [string, Entry][] = [[id, { type: 'message', role, at, ...held(first!) }]];
  const made = new Map(versions.map((version, index) => [version.id, ids[index]!]));
  if (first!.edited || first!.at !== at) {
    const again = crypto.randomUUID();
    made.set(first!.id, again);
    entries.push([again, { type: 'version', message: id, replaces: id, edit: first!.edited, at: first!.at, ...held(first!) }]);
  }
  rest.forEach((version, index) => {
    entries.push([ids[index + 1]!, { type: 'version', message: id, replaces: null, edit: version.edited, at: version.at, ...held(version) }]);
  });
  if (selected !== versions.length - 1) entries.push([crypto.randomUUID(), { type: 'select', message: id, version: ids[selected]!, at: versions[selected]!.at }]);
  return { entries, versions: made };
}

// A blank name gives the chat back its first message as its name.
export const renameChat = (store: ObjectStore, id: string, name: string) => store.update('chat', id, (current) => ({ ...current, title: name.trim() || null }));

// Removes the chat object only. Its entries stay, unreachable, so restoreChat (되돌리기) brings back all of it.
export const removeChat = (store: ObjectStore, id: string) => store.take('chat', id);

export const restoreChat = (store: ObjectStore, removed: Stored<'chat'>) => store.restore(removed);

// A chat's own prompt, persona or 작가의 노트; null clears it, and the chat follows the default again.
function setOwn(store: ObjectStore, chat: string, field: 'prompt' | 'persona' | 'note', value: string | null): Promise<ApiResult<Stored<'chat'>>> {
  return store.update('chat', chat, (current) => (value === null ? without(current, field) : { ...current, [field]: value }));
}

export const setChatPrompt = (store: ObjectStore, chat: string, prompt: string | null) => setOwn(store, chat, 'prompt', prompt);

export const setChatPersona = (store: ObjectStore, chat: string, persona: string | null) => setOwn(store, chat, 'persona', persona);

export const setChatNote = (store: ObjectStore, chat: string, note: string | null) => setOwn(store, chat, 'note', note);

const append = (store: ObjectStore, chat: string, entry: Entry, id?: string) => store.create('entry', entry, { id, parent: chat });

// translation: what the user typed, when text is its translation sent.
export type Said = { id: string; text: string; translation?: Translation };

export const appendUserMessage = (store: ObjectStore, chat: string, { id, text, translation }: Said) =>
  append(store, chat, { type: 'message', role: 'user', at: Date.now(), text, receipt: null, ...(translation && { translation }) }, id);

// A reply as its stream ended: a new message, or a new version of `message`, in place of `replaces` on
// 다시 시도. at is the reply's own, never the time of the save, so saving it again (Talk.saveAgain)
// sends the same entry, and a first try that landed unanswered is found as it is.
export type Written = { id: string; message: string | null; replaces: string | null; at: number; text: string; receipt: Receipt; seed?: string };

export function appendReply(store: ObjectStore, chat: string, { id, message, replaces, at, text, receipt, seed }: Written) {
  return append(store, chat, message === null ? { type: 'message', role: 'assistant', at, text, receipt } : { type: 'version', message, replaces, edit: false, at, text, receipt, ...(seed && { seed }) }, id);
}

export const appendCost = (store: ObjectStore, chat: string, replyId: string, cost: Cost | null) => append(store, chat, { type: 'cost', replyId, cost, at: Date.now() });

// An edit is a new version in the place of the one shown, keeping its receipt. translation: the
// edited translation of a version that has one, which keeps the receipt of the call that made it; a blank one leaves
// the new version without a translation.
export function editMessage(store: ObjectStore, chat: string, message: Message, text: string, translation: string | null) {
  const current = shown(message);
  const at = Date.now();
  const kept = translation?.trim() && current.translation && { translation: { text: translation, receipt: current.translation.receipt, at } };
  return append(store, chat, { type: 'version', message: message.id, replaces: current.id, edit: true, at, text, receipt: current.receipt, seed: current.seed, ...kept });
}

// id: the call's, so a call another device saved too is known as saved (runtime/streams).
export const appendTranslation = (store: ObjectStore, chat: string, version: string, translation: Translation, id: string) =>
  append(store, chat, { type: 'translation', version, ...translation }, id);

export const selectVersion = (store: ObjectStore, chat: string, message: string, version: string) => append(store, chat, { type: 'select', message, version, at: Date.now() });

export const removeMessage = (store: ObjectStore, chat: string, message: string) => append(store, chat, { type: 'delete', message, at: Date.now() });

export const restoreMessage = (store: ObjectStore, chat: string, message: string) => append(store, chat, { type: 'restore', message, at: Date.now() });
