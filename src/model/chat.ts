import type { Assignment, ModelRef } from '../connectors/assignment';
import type { Cost, Usage } from '../connectors/types';
import type { Stored } from './kinds';

// The stored `chat` object (tech-spec §5). Its messages are `entry` objects whose parent is the chat.
export type Chat = {
  // null until the user names the chat; until then it is called by its first message (chatTitle).
  title: string | null;
  // A chat with no character talks to the model as it is. Characters arrive with import (design F2).
  character: string | null;
  // The 채팅 layer of the model assignment (design §4.1), written by the model button (F4).
  models: Assignment;
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
export type Entry =
  // A new message with its first version, which has the entry's id.
  | { type: 'message'; role: 'user' | 'assistant'; at: number; text: string; receipt: Receipt | null }
  // replaces: the version this one takes the place of, for an edit or a retried failure, so the count
  // of versions does not grow; null for a new version, which goes last. An edit keeps the receipt of
  // the reply it changes.
  | { type: 'version'; message: string; replaces: string | null; edit: boolean; at: number; text: string; receipt: Receipt | null }
  | { type: 'select'; message: string; version: string; at: number }
  | { type: 'delete'; message: string; at: number }
  | { type: 'restore'; message: string; at: number }
  // A cost the provider booked after the reply (connector settle), for every version with this replyId.
  | { type: 'cost'; replyId: string; cost: Cost | null; at: number };

export type Version = { id: string; text: string; receipt: Receipt | null; edited: boolean; at: number };
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
      const version = { id, text: entry.text, receipt: entry.receipt, edited: false, at: entry.at };
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
      const version = { id, text: entry.text, receipt: entry.receipt, edited: entry.edit, at: entry.at };
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

  const settled = (version: Version): Version => {
    const receipt = version.receipt;
    if (receipt?.cost !== 'pending' || !receipt.replyId || !costs.has(receipt.replyId)) return version;
    return { ...version, receipt: { ...receipt, cost: costs.get(receipt.replyId)! } };
  };
  return [...messages.values()]
    .filter((message) => !deleted.has(message.id))
    .map((message) => ({ ...message, versions: message.versions.map(settled) }));
}

export const shown = (message: Message): Version => message.versions[message.selected]!;

const firstLine = (text: string) => text.trim().split('\n')[0]!.trim();

// display turns a message's stored text into the text shown (engine/render, which the model cannot call).
type Display = (text: string) => string;

export function chatTitle(chat: Chat, messages: Message[], display: Display): string {
  if (chat.title) return chat.title;
  const first = messages.find((message) => message.role === 'user');
  return (first && firstLine(display(shown(first).text))) || '새 채팅';
}

export function preview(messages: Message[], display: Display): string {
  const last = messages.at(-1);
  return last ? firstLine(display(shown(last).text)) : '';
}

export type ChatItem = { id: string; chat: Chat; messages: Message[]; title: string; preview: string; at: number | null; order: number };

// Every chat with its messages, the one written to last first. Renaming a chat or changing its model
// does not move it.
export function chatItems(chats: Stored<'chat'>[], entriesOf: (chat: string) => Stored<'entry'>[], display: (chat: Chat, text: string) => string): ChatItem[] {
  return chats
    .map((chat) => {
      const own = entriesOf(chat.id);
      const messages = fold(own);
      const latest = own.reduce<Stored<'entry'> | null>((last, entry) => (last && last.rev > entry.rev ? last : entry), null);
      const show = (text: string) => display(chat.value, text);
      return {
        id: chat.id,
        chat: chat.value,
        messages,
        title: chatTitle(chat.value, messages, show),
        preview: preview(messages, show),
        at: latest?.value.at ?? null,
        order: latest?.rev ?? chat.rev,
      };
    })
    .sort((a, b) => b.order - a.order);
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
