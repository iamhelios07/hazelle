import type { Assignment, ModelRef } from '../connectors/assignment';
import type { Cost, Usage } from '../connectors/types';
import type { Stored } from './kinds';

// The stored `chat` object (tech-spec §5). Its messages are `entry` objects whose parent is the chat.
export type Chat = {
  // null until the user names the chat; until then it is called by its first message, or a branch after its
  // origin (chatTitle).
  title: string | null;
  // A chat with no character talks to the model as it is. Characters arrive with import (design F2).
  character: string | null;
  // The 채팅 layer of the model assignment (design §4.1), written by the model button (F4).
  models: Assignment;
  // The chat's own prompt, persona and 작가의 노트; each absent follows the default (design §4.2, §4.3).
  prompt?: string;
  persona?: string;
  note?: string;
  // A branch's original chat, named as it was then so a renamed or deleted one still reads; after is the message
  // of this chat that the split comes after, where its divider stands (design F3).
  origin?: { id: string; name: string; after: string };
  // The id pick and rollp roll from in place of this chat's own: a branch keeps its original's, so the history
  // it copied reads the same.
  seed?: string;
};

// What a reply's generation left behind (tech-spec §5). The raw request is never stored.
export type Receipt = {
  connection: string;
  // The connection's and the model's names when the reply was made; either may be renamed or deleted later.
  source: string;
  model: string;
  modelName: string;
  state: 'done' | 'cut' | 'failed';
  cut: 'length' | 'no-terminal' | 'stopped' | null;
  error: ReceiptError | null;
  finishReason: string | null;
  usage: Usage | null;
  // pending until a `cost` entry for replyId arrives.
  cost: Cost | 'pending' | null;
  replyId: string | null;
  firstTextMs: number | null;
  totalMs: number;
  // 이어 쓰기: the receipt of the reply this one continued, as it read then, so every call and its cost stays
  // visible after the continued version replaces the cut one. It nests when a continuation is continued again.
  continues?: Receipt;
};

// A receipt's own copy of runtime/generate ReplyError, converted where the receipt is written, so a
// change to the network's failure types never changes what saved chats hold. A stop is a cut, never
// an error. status is there when the provider refused the request, and absent when its stream failed.
export type ReceiptError =
  | { kind: 'refused'; code: string }
  | { kind: 'relay'; code: string }
  | { kind: 'app'; code: string }
  | { kind: 'provider'; status: number; detail: string }
  | { kind: 'provider'; detail: string }
  | { kind: 'bad-event'; detail: string }
  | { kind: 'network'; detail: string }
  | { kind: 'offline' }
  | { kind: 'no-token' };

// Chat entries are created and never changed (design §3): an edit, a swipe or a deletion is a new
// entry. at is the writer's clock, for showing times only; order is the server's rev.
// seed: the id a version's random tags roll from in place of its own. A branch's copy keeps its original's, and
// an edit or a continued cut keeps the seed of the version it replaces, so text already shown never rolls again.
export type Entry =
  // A new message with its first version, which has the entry's id.
  | { type: 'message'; role: 'user' | 'assistant'; at: number; text: string; receipt: Receipt | null; seed?: string }
  // replaces: the version this one takes the place of, for an edit, a retried failure or a continued cut
  // (이어 쓰기), so the count of versions does not grow; null for a new version, which goes last. An edit keeps
  // the receipt of the reply it changes.
  | { type: 'version'; message: string; replaces: string | null; edit: boolean; at: number; text: string; receipt: Receipt | null; seed?: string }
  | { type: 'select'; message: string; version: string; at: number }
  | { type: 'delete'; message: string; at: number }
  | { type: 'restore'; message: string; at: number }
  // A cost the provider booked after the reply (connector settle), for every receipt with this replyId, the
  // ones a continued reply carries (Receipt continues) included.
  | { type: 'cost'; replyId: string; cost: Cost | null; at: number };

export type Version = { id: string; seed: string; text: string; receipt: Receipt | null; edited: boolean; at: number };
export type Message = { id: string; role: 'user' | 'assistant'; at: number; versions: Version[]; selected: number };

// A chat's entries, read in rev order into the messages on screen. Entries naming a message or version
// that is not there (yet) are skipped.
export function fold(entries: Stored<'entry'>[]): Message[] {
  const messages = new Map<string, Message>();
  const deleted = new Set<string>();
  // A replaced version's id keeps leading to the version that took its place.
  const versions = new Map<string, Version>();
  const costs = new Map<string, Cost | null>();
  const locate = (message: Message, id: string) => {
    const version = versions.get(id);
    return version ? message.versions.indexOf(version) : -1;
  };

  for (const { id, value: entry } of [...entries].sort((a, b) => a.rev - b.rev)) {
    if (entry.type === 'message') {
      const version = { id, seed: entry.seed ?? id, text: entry.text, receipt: entry.receipt, edited: false, at: entry.at };
      versions.set(id, version);
      messages.set(id, { id, role: entry.role, at: entry.at, versions: [version], selected: 0 });
      continue;
    }
    if (entry.type === 'cost') {
      costs.set(entry.replyId, entry.cost);
      continue;
    }
    const message = messages.get(entry.message);
    if (!message) continue;
    if (entry.type === 'version') {
      const version = { id, seed: entry.seed ?? id, text: entry.text, receipt: entry.receipt, edited: entry.edit, at: entry.at };
      const slot = entry.replaces === null ? -1 : locate(message, entry.replaces);
      if (slot === -1) message.versions.push(version);
      else message.versions[slot] = version;
      versions.set(id, version);
      if (entry.replaces !== null && slot !== -1) versions.set(entry.replaces, version);
      message.selected = slot === -1 ? message.versions.length - 1 : slot;
    } else if (entry.type === 'select') {
      const slot = locate(message, entry.version);
      if (slot !== -1) message.selected = slot;
    } else if (entry.type === 'delete') {
      deleted.add(message.id);
    } else {
      deleted.delete(message.id);
    }
  }

  const settled = (receipt: Receipt): Receipt => {
    const earlier = receipt.continues && settled(receipt.continues);
    const own = receipt.cost === 'pending' && receipt.replyId && costs.has(receipt.replyId) ? { ...receipt, cost: costs.get(receipt.replyId)! } : receipt;
    return earlier === receipt.continues ? own : { ...own, continues: earlier };
  };
  return [...messages.values()]
    .filter((message) => !deleted.has(message.id))
    .map((message) => ({
      ...message,
      versions: message.versions.map((version) => {
        const receipt = version.receipt && settled(version.receipt);
        return receipt === version.receipt ? version : { ...version, receipt };
      }),
    }));
}

export const shown = (message: Message): Version => message.versions[message.selected]!;

// The calls a reply took, the first one first: one, or more when it was continued (이어 쓰기).
export const calls = (receipt: Receipt): Receipt[] => [...(receipt.continues ? calls(receipt.continues) : []), receipt];

const firstLine = (text: string) => text.trim().split('\n')[0]!.trim();

// texts: each message's text as it is displayed (engine/render, which the model cannot call).
export function chatTitle(chat: Chat, messages: Message[], texts: string[]): string {
  if (chat.title) return chat.title;
  if (chat.origin) return `${chat.origin.name} · 갈래`;
  const first = messages.findIndex((message) => message.role === 'user');
  return (first !== -1 && firstLine(texts[first]!)) || '새 채팅';
}

export type ChatItem = { id: string; chat: Chat; messages: Message[]; title: string; preview: string; at: number | null; order: number };

// Every chat with its messages, the one written to last first. Renaming a chat or changing its model
// does not move it.
export function chatItems(chats: Stored<'chat'>[], entriesOf: (chat: string) => Stored<'entry'>[], display: (chat: Stored<'chat'>, messages: Message[]) => string[]): ChatItem[] {
  return chats
    .map((chat) => {
      const own = entriesOf(chat.id);
      const messages = fold(own);
      const latest = own.reduce<Stored<'entry'> | null>((last, entry) => (last && last.rev > entry.rev ? last : entry), null);
      const texts = display(chat, messages);
      const last = texts.at(-1);
      return {
        id: chat.id,
        chat: chat.value,
        messages,
        title: chatTitle(chat.value, messages, texts),
        preview: last === undefined ? '' : firstLine(last),
        at: latest?.value.at ?? null,
        order: latest?.rev ?? chat.rev,
      };
    })
    .sort((a, b) => b.order - a.order);
}

// One shelf's chats with each branch right under the chat it came from, in the order given at each level
// (design F3). A branch whose origin is not among them stands at the top level.
export function branchTree(items: ChatItem[]): { item: ChatItem; nested: boolean }[] {
  const ids = new Set(items.map((item) => item.id));
  const parent = ({ chat }: ChatItem) => (chat.origin && ids.has(chat.origin.id) ? chat.origin.id : null);
  const under = (origin: string | null): { item: ChatItem; nested: boolean }[] =>
    items.filter((item) => parent(item) === origin).flatMap((item) => [{ item, nested: origin !== null }, ...under(item.id)]);
  return under(null);
}

// Models used lately across all chats, newest first, for the model picker's 최근 (design F4).
export function recentModels(chats: Message[][], limit: number): ModelRef[] {
  const used = chats
    .flat()
    .flatMap((message) => message.versions)
    .flatMap((version) => (version.receipt ? [{ at: version.at, ref: { connection: version.receipt.connection, model: version.receipt.model } }] : []))
    .sort((a, b) => b.at - a.at);
  const seen = new Set<string>();
  const refs: ModelRef[] = [];
  for (const { ref } of used) {
    const key = `${ref.connection}/${ref.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
    if (refs.length === limit) break;
  }
  return refs;
}
