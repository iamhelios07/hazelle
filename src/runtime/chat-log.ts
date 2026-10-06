import type { Cost } from '../connectors/types';
import type { RisuMessage } from '../engine/import/types';
import { memoryThrough } from '../engine/memory';
import { CAST_MAX, shown, type Chat, type ChatItem, type Entry, type Message, type Receipt, type Translation, type Writes } from '../model/chat';
import type { Stored } from '../model/kinds';
import { memoryId, type Memory, type Source } from '../model/memory';
import type { ApiFailure, ApiResult } from './api';
import { markDeleted } from './characters';
import type { Greetings } from './greetings';
import { withPersona } from './personas';
import { without, type ObjectStore, type Write } from './store';

// The only writer of `chat` and `entry` objects, except a chat's `models` layer, which runtime/assignment writes with
// the other layers, a purge (runtime/characters), which claims a deleted chat and removes it with all it owns, or with
// its character, a backup's restore, which copies them as they were, and a move from Risu, which saves chatWrites'
// entries before its character and the chat root with it (runtime/characters addCharacter).

// A new chat is saved in this order: the chat with its greetings, the one shown selected, then the user's first
// message, sent with its reply. Messages stand in the order they were saved, so the greeting leads only when it is
// saved before the message. The chat and its greetings are one batch, which writes the greetings first, so the
// chat is never there without them: its screen would show it greeting-less until they landed.
// id is the one the chat was shown under before it was saved, which seeds its greeting's pick and rollp tags.
export async function startChat(store: ObjectStore, id: string, chat: Chat, greetings: Greetings | null): Promise<ApiFailure | null> {
  const { entries, root } = chatWrites(id, withPersona(store, chat), greetings, []);
  const saved = await store.batch([...entries, root]);
  return saved.ok ? null : saved;
}

// A new chat's writes: its greetings, then the messages it already holds (a chat brought from Risu), in the order they
// fold, and its root, which is written with or after them.
export function chatWrites(id: string, chat: Chat, greetings: Greetings | null, messages: RisuMessage[]): { entries: Write[]; root: Write } {
  // A moved chat's greeting takes its first message's time, so it does not read as newer than what follows it.
  const entries = greetings ? greetingWrites(id, greetings, messages[0]?.at ?? Date.now()) : [];
  for (const { role, text, at, reasoning } of messages) {
    entries.push({ type: 'create', kind: 'entry', id: crypto.randomUUID(), parent: id, value: { type: 'message', role, at, text, receipt: null, staged: true, ...(reasoning && { reasoning }) } });
  }
  return { entries, root: { type: 'create', kind: 'chat', id, parent: null, value: chat } };
}

// Greetings are saved as the card wrote them; engine/render fills them each time they are shown or sent.
function greetingWrites(chat: string, { choices, selected }: Greetings, at: number): Write[] {
  const first = choices[0]!.id;
  const entries: [string, Entry][] = choices.map(({ id, index: greeting, text, translation }, index) => {
    const common = { at, text, receipt: null, greeting, ...(translation && { translation }) };
    return [id, index === 0 ? { type: 'message', role: 'assistant', ...common } : { type: 'version', message: first, replaces: null, edit: false, ...common }];
  });
  // Adding a version selects it, so without a select the chat would open on the last greeting.
  if (selected !== choices.length - 1) entries.push([crypto.randomUUID(), { type: 'select', message: first, version: choices[selected]!.id, at }]);
  return entries.map(([id, value]) => ({ type: 'create', kind: 'entry', id, parent: chat, value }));
}

// The spread takes the original's own choices; nothing links the two chats but origin, so deleting either leaves the
// other whole.
export async function branchChat(store: ObjectStore, item: ChatItem, message: string): Promise<ApiResult<string>> {
  return store.withChat(item.id, async () => {
    const current = store.projection(item.id)?.model;
    if (!current) return { ok: false, error: 'gone' };
    item = current;
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
    const memory = store.children('memory', item.id).find((entry) => entry.id === memoryId(item.id))?.value;
    const kept = memory && branchMemory(memory, messages, versions);
    if (kept) writes.push({ type: 'create', kind: 'memory', id: memoryId(id), parent: id, value: kept });
    writes.push({ type: 'create', kind: 'chat', id, parent: null, value: { ...item.chat, title: null, origin: { id: item.id, name: item.title, after }, seed: item.chat.seed ?? item.id } });
    const created = await store.batch(writes);
    return created.ok ? { ok: true, data: id } : created;
  });
}

// The records whose every message lies before the split, their sources remapped to the branch's messages and versions
// (a version the branch does not hold keeps its old id, so the record stays stale there too), with the facts and threads
// as they stood with only those records (engine/memory memoryThrough). A record across the split stays behind, and its
// messages stay raw in the branch until its own summarizing reaches them. null: nothing to carry.
function branchMemory(memory: Memory, messages: ReadonlyMap<string, string>, versions: ReadonlyMap<string, string>): Memory | null {
  const remap = ({ message, version }: Source): Source => ({ message: messages.get(message)!, version: versions.get(version) ?? version });
  const kept = memoryThrough(memory, memory.records.filter(({ sources }) => sources.every(({ message }) => messages.has(message))));
  const records = kept.records.map((record) => ({ ...record, sources: record.sources.map(remap) }));
  return records.length || kept.state.length || kept.threads.length ? { ...kept, records } : null;
}

// The entries that fold back to message under the id given: its first version as the message entry, and that
// version again in its own place when it is an edit or came later than the message, which a message entry cannot
// hold; the other versions; and a select when the one shown is not the last, since adding a version selects it.
// versions: each version's id in the branch, by its id here.
// A field added to versions or messages must be written here too, or a branch drops it. The calls the bot's Lua made
// (Version.calls) are dropped on purpose: usage counts a call where it was made.
function copied(id: string, { role, at, versions, selected, after }: Message): { entries: [string, Entry][]; versions: Map<string, string> } {
  const ids = versions.map((_, index) => (index === 0 ? id : crypto.randomUUID()));
  const [first, ...rest] = versions;
  const held = ({ text, receipt, seed, translation, staged, before, reasoning, greeting }: Message['versions'][number]) => ({ text, receipt, seed, ...(translation && { translation }), ...(staged && { staged }), ...(before && { before }), ...(reasoning && { reasoning }), ...(greeting !== undefined && { greeting }) });
  // The first version said again holds its own writes: an edit would add them to the message entry's.
  const repeated = first!.edited || first!.at !== at;
  const entries: [string, Entry][] = [[id, { type: 'message', role, at, ...held(repeated ? { ...first!, before: undefined } : first!) }]];
  const made = new Map(versions.map((version, index) => [version.id, ids[index]!]));
  if (repeated) {
    const again = crypto.randomUUID();
    made.set(first!.id, again);
    entries.push([again, { type: 'version', message: id, replaces: id, edit: first!.edited, at: first!.at, ...held(first!) }]);
  }
  rest.forEach((version, index) => {
    entries.push([ids[index + 1]!, { type: 'version', message: id, replaces: null, edit: version.edited, at: version.at, ...held(version) }]);
  });
  if (selected !== versions.length - 1) entries.push([crypto.randomUUID(), { type: 'select', message: id, version: ids[selected]!, at: versions[selected]!.at }]);
  for (const version of versions) if (version.after) entries.push([crypto.randomUUID(), { type: 'vars', version: made.get(version.id)!, set: version.after, at: version.at }]);
  if (after) entries.push([crypto.randomUUID(), { type: 'vars', version: made.get(versions[selected]!.id)!, set: after, at, stays: true }]);
  return { entries, versions: made };
}

// A blank name gives the chat back its first message as its name.
export const renameChat = (store: ObjectStore, id: string, name: string) => store.update('chat', id, (current) => ({ ...current, title: name.trim() || null }));

// The chat stays whole, read as gone (model/library live), until purgeExpired removes it with all it owns; restoreChat
// (되돌리기) brings it back until then.
export const removeChat = (store: ObjectStore, id: string) => markDeleted(store, 'chat', id, Date.now());

export const restoreChat = (store: ObjectStore, id: string) => markDeleted(store, 'chat', id, null);

// null clears it, and the chat follows the default again.
function setOwn(store: ObjectStore, chat: string, field: 'prompt' | 'persona' | 'note', value: string | null): Promise<ApiResult<Stored<'chat'>>> {
  return store.update('chat', chat, (current) => (value === null ? without(current, field) : { ...current, [field]: value }));
}

export const setChatPrompt = (store: ObjectStore, chat: string, prompt: string | null) => setOwn(store, chat, 'prompt', prompt);

export const setChatPersona = (store: ObjectStore, chat: string, persona: string | null) => setOwn(store, chat, 'persona', persona);

export const setChatNote = (store: ObjectStore, chat: string, note: string | null) => setOwn(store, chat, 'note', note);

export function withCast<T extends Pick<Chat, 'cast'>>(chat: T, character: string | null, ids: string[]): T {
  const cast = [...new Set(ids)].filter((id) => id !== character).slice(0, CAST_MAX);
  return cast.length ? { ...chat, cast } : without(chat, 'cast');
}

export const setCast = (store: ObjectStore, chat: string, ids: string[]) => store.update('chat', chat, (current) => withCast(current, current.character, ids));

const append = (store: ObjectStore, chat: string, entry: Entry, id?: string) => store.create('entry', entry, { id, parent: chat });

// translation: what the user typed, when text is its translation sent. before: what the bot's Lua wrote as it was
// sent (model/chat Entry).
export type Said = { id: string; text: string; translation?: Translation; before?: Writes };

export const appendUserMessage = (store: ObjectStore, chat: string, { id, text, translation, before }: Said) =>
  append(store, chat, { type: 'message', role: 'user', at: Date.now(), text, receipt: null, ...(translation && { translation }), ...(before && { before }) }, id);

// at is the reply's own, never the time of the save, so saving it again (Talk.saveAgain) sends the same entry, and a
// first try that landed unanswered is found as it is.
export type Written = { id: string; message: string | null; replaces: string | null; at: number; text: string; receipt: Receipt; seed?: string; before?: Writes; reasoning?: string };

export function appendReply(store: ObjectStore, chat: string, { id, message, replaces, at, text, receipt, seed, before, reasoning }: Written) {
  const held = { at, text, receipt, ...(before && { before }), ...(reasoning && { reasoning }) };
  return append(store, chat, message === null ? { type: 'message', role: 'assistant', ...held } : { type: 'version', message, replaces, edit: false, ...held, ...(seed && { seed }) }, id);
}

// edits: a message's new text in place of its shown version, with the variables that version's own text wrote, which
// the new text no longer does. vars: the variables written, standing after a version, or with stays after its message
// (Entry vars).
export type Scripted = {
  edits: { message: Message; text: string; wrote: Writes }[];
  removed: string[];
  added: { role: 'user' | 'assistant'; text: string }[];
  vars: { version: string; set: Writes; stays?: true } | null;
};

// One batch, so a run's changes land together. What Lua writes is already past the input and output scripts.
export function appendScripted(store: ObjectStore, chat: string, { edits, removed, added, vars }: Scripted): Promise<ApiResult<null>> {
  const at = Date.now();
  const entries: Entry[] = [
    ...edits.map(({ message, text, wrote }): Entry => {
      const current = shown(message);
      return { type: 'version', message: message.id, replaces: current.id, edit: true, at, text, receipt: current.receipt, seed: current.seed, staged: true, ...(wrote.length > 0 && { before: wrote }), ...(current.greeting !== undefined && { greeting: current.greeting }) };
    }),
    ...removed.map((message): Entry => ({ type: 'delete', message, at })),
    ...added.map(({ role, text }): Entry => ({ type: 'message', role, at, text, receipt: null, staged: true })),
    ...(vars && vars.set.length > 0 ? [{ type: 'vars', version: vars.version, set: vars.set, at, ...(vars.stays && { stays: true }) } satisfies Entry] : []),
  ];
  if (entries.length === 0) return Promise.resolve({ ok: true, data: null });
  return store.batch(entries.map((value) => ({ type: 'create', kind: 'entry', id: crypto.randomUUID(), parent: chat, value })));
}

export const appendCall = (store: ObjectStore, chat: string, version: string, receipt: Receipt) => append(store, chat, { type: 'call', version, receipt, at: Date.now() });

export const appendCost = (store: ObjectStore, chat: string, replyId: string, cost: Cost | null) => append(store, chat, { type: 'cost', replyId, cost, at: Date.now() });

// An edit is a new version in the place of the one shown, keeping its receipt. translation: the
// edited translation of a version that has one, which keeps the receipt of the call that made it; a blank one leaves
// the new version without a translation.
export function editMessage(store: ObjectStore, chat: string, message: Message, text: string, translation: string | null) {
  const current = shown(message);
  const at = Date.now();
  const kept = translation?.trim() && current.translation && { translation: { ...current.translation, text: translation, at } };
  return append(store, chat, { type: 'version', message: message.id, replaces: current.id, edit: true, at, text, receipt: current.receipt, seed: current.seed, ...(current.greeting !== undefined && { greeting: current.greeting }), ...kept });
}

// id: the call's, so a call another device saved too is known as saved (runtime/streams).
export const appendTranslation = (store: ObjectStore, chat: string, version: string, translation: Translation, id: string) =>
  append(store, chat, { type: 'translation', version, ...translation }, id);

// A conflict over an entry already there is the same call saved by another device that read it too. Each device
// stamps its own copy, so the store's check for a create that already landed misses it.
export const savedElsewhere = (store: ObjectStore, chat: string, id: string, failure: ApiFailure) =>
  failure.error === 'conflict' && store.children('entry', chat).some((entry) => entry.id === id);

export const selectVersion = (store: ObjectStore, chat: string, message: string, version: string) => append(store, chat, { type: 'select', message, version, at: Date.now() });

export const removeMessage = (store: ObjectStore, chat: string, message: string) => append(store, chat, { type: 'delete', message, at: Date.now() });

export const restoreMessage = (store: ObjectStore, chat: string, message: string) => append(store, chat, { type: 'restore', message, at: Date.now() });
