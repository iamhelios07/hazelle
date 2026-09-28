import { resolveRole } from '../connectors/assignment';
import type { Connection, Model } from '../connectors/types';
import type { ApiFailure } from './api';
import { fold, history, shown, type Chat, type Entry, type Message, type Receipt } from './chat';
import { settleCost } from './cost';
import { SETTINGS_ID, type Settings } from './docs';
import { generate } from './generate';
import type { ObjectStore, Stored } from './store';

// The reply being written. user is the message sent with it, shown until the store has it; reply says
// where the answer goes: a new message, or a new version of one (in place of a failed one on 다시 시도).
export type Turn = {
  chat: string;
  user: { id: string; text: string } | null;
  reply: { id: string; message: string | null; replaces: string | null };
  text: string;
};

// unsent: the user's message was not saved, so its reply was stopped. unsaved: the reply was written
// but not saved; saveAgain tries once more.
export type TalkFailure =
  | { kind: 'no-model' }
  | { kind: 'model-gone' }
  | { kind: 'unsent'; failure: ApiFailure }
  | { kind: 'unsaved'; failure: ApiFailure };

export type Route = { connection: Stored<Connection>; model: Model };

// The 본 대화 model for a chat: its own layer, then 전체 기본값 (design §4.1).
export function chatModel(store: ObjectStore, chat: Chat): Route | TalkFailure {
  const ref = resolveRole('main', [chat.models, store.get<Settings>(SETTINGS_ID)?.value.models ?? {}]);
  if (!ref) return { kind: 'no-model' };
  const connection = store.get<Connection>(ref.connection);
  const model = connection?.value.starred.find((starred) => starred.id === ref.model);
  return connection && model ? { connection, model } : { kind: 'model-gone' };
}

export const chatEntries = (store: ObjectStore, chat: string) => store.list<Entry>('entry').filter((entry) => entry.parent === chat);

export function addEntry(store: ObjectStore, chat: string, entry: Entry) {
  return store.save<Entry>('entry', crypto.randomUUID(), () => entry, chat);
}

// The chat's messages with the turn laid over them, until its entries are saved. live marks the version
// being written.
export function withTurn(messages: Message[], turn: Turn | null, chat: string): (Message & { live: string | null })[] {
  const out = messages.map((message) => ({ ...message, live: null as string | null }));
  if (turn?.chat !== chat) return out;
  const { user, reply } = turn;
  if (user && !out.some((message) => message.id === user.id)) {
    out.push({ id: user.id, role: 'user', at: Date.now(), versions: [{ id: user.id, text: user.text, receipt: null, edited: false, at: Date.now() }], selected: 0, live: null });
  }
  const version = { id: reply.id, text: turn.text, receipt: null, edited: false, at: Date.now() };
  if (reply.message === null) {
    if (!out.some((message) => message.id === reply.id)) out.push({ id: reply.id, role: 'assistant', at: Date.now(), versions: [version], selected: 0, live: reply.id });
    return out;
  }
  const index = out.findIndex((message) => message.id === reply.message);
  const message = out[index];
  if (!message || message.versions.some((existing) => existing.id === reply.id)) return out;
  const slot = reply.replaces === null ? -1 : message.versions.findIndex((existing) => existing.id === reply.replaces);
  const versions = slot === -1 ? [...message.versions, version] : message.versions.with(slot, version);
  out[index] = { ...message, versions, selected: slot === -1 ? versions.length - 1 : slot, live: reply.id };
  return out;
}

// One reply is written at a time, app-wide, and it outlives the screen that asked for it: leaving a
// chat does not stop its reply. close() stops everything, for a locked vault.
export class Talk {
  private turn: Turn | null = null;
  private abort: AbortController | null = null;
  private unsaved: { chat: string; id: string; entry: Entry } | null = null;
  private readonly lookups = new AbortController();
  private readonly settling = new Set<string>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly store: ObjectStore) {}

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = () => this.turn;

  send(chat: string, text: string) {
    return this.run(chat, { message: null, replaces: null }, text);
  }

  // 답장 받기: a reply to the last message, sending nothing new.
  answer(chat: string) {
    return this.run(chat, { message: null, replaces: null }, null);
  }

  regenerate(chat: string, message: string) {
    return this.run(chat, { message, replaces: null }, null);
  }

  retry(chat: string, message: string, version: string) {
    return this.run(chat, { message, replaces: version }, null);
  }

  stop() {
    this.abort?.abort();
  }

  close() {
    this.stop();
    this.lookups.abort();
  }

  // A reply whose save failed is kept in memory for one more try.
  async saveAgain(): Promise<TalkFailure | null> {
    const unsaved = this.unsaved;
    if (!unsaved) return null;
    const saved = await this.store.save<Entry>('entry', unsaved.id, () => unsaved.entry, unsaved.chat);
    if (!saved.ok) return { kind: 'unsaved', failure: saved };
    this.unsaved = null;
    this.settleFrom(unsaved.chat, unsaved.entry);
    return null;
  }

  // Looks up a cost the provider books after the reply. Asked again when a reply shows 확인 중 after a
  // reload, since the page that wrote it may have closed before the cost came.
  settle(chat: string, receipt: Receipt) {
    const connection = this.store.get<Connection>(receipt.connection);
    if (receipt.cost !== 'pending' || !receipt.replyId || !connection || this.settling.has(receipt.replyId)) return;
    const replyId = receipt.replyId;
    this.settling.add(replyId);
    void settleCost(connection.value, replyId, this.lookups.signal).then(async (settled) => {
      if (this.lookups.signal.aborted) return;
      await addEntry(this.store, chat, { type: 'cost', replyId, cost: settled.ok ? settled.cost : null, at: Date.now() });
      this.settling.delete(replyId);
    });
  }

  private settleFrom(chat: string, entry: Entry) {
    if ((entry.type === 'message' || entry.type === 'version') && entry.receipt) this.settle(chat, entry.receipt);
  }

  private set(turn: Turn | null) {
    this.turn = turn;
    for (const listener of this.listeners) listener();
  }

  private async run(chat: string, target: { message: string | null; replaces: string | null }, text: string | null): Promise<TalkFailure | null> {
    const stored = this.store.get<Chat>(chat);
    if (this.turn || !stored) return null;
    const route = chatModel(this.store, stored.value);
    if ('kind' in route) return route;

    const messages = fold(chatEntries(this.store, chat));
    const at = target.message === null ? messages.length : messages.findIndex((message) => message.id === target.message);
    if (at === -1) return null;
    const before = messages.slice(0, at);
    const user = text === null ? null : { id: crypto.randomUUID(), text };
    const turn: Turn = { chat, user, reply: { id: crypto.randomUUID(), ...target }, text: '' };
    this.set(turn);
    const abort = new AbortController();
    this.abort = abort;

    const sending = user && this.store.save<Entry>('entry', user.id, () => ({ type: 'message', role: 'user', at: Date.now(), text: user.text, receipt: null }), chat);
    const replying = generate({
      connection: route.connection.value,
      model: route.model,
      messages: [...history(before), ...(user ? [{ role: 'user' as const, content: user.text }] : [])],
      maxTokens: null,
      signal: abort.signal,
      onText: (phase, chunk) => phase === 'text' && this.set({ ...this.turn!, text: this.turn!.text + chunk }),
    });
    const sent = await sending;
    if (sent && !sent.ok) {
      abort.abort();
      await replying;
      this.set(null);
      return { kind: 'unsent', failure: sent };
    }
    const reply = await replying;

    const receipt: Receipt = {
      connection: route.connection.id,
      source: route.connection.value.label,
      model: route.model.id,
      modelName: route.model.name,
      state: reply.state,
      cut: reply.cut,
      error: reply.error,
      finishReason: reply.finishReason,
      usage: reply.usage,
      cost: reply.cost,
      replyId: reply.replyId,
      firstTextMs: reply.firstTextMs,
      totalMs: reply.totalMs,
    };
    const written = this.turn!.text;
    const entry: Entry =
      target.message === null
        ? { type: 'message', role: 'assistant', at: Date.now(), text: written, receipt }
        : { type: 'version', message: target.message, replaces: target.replaces, edit: false, at: Date.now(), text: written, receipt };
    const saved = await this.store.save<Entry>('entry', turn.reply.id, () => entry, chat);
    this.set(null);
    if (!saved.ok) {
      this.unsaved = { chat, id: turn.reply.id, entry };
      return { kind: 'unsaved', failure: saved };
    }
    this.settleFrom(chat, entry);
    return null;
  }
}

// An edit is a new version in the place of the one shown, keeping its receipt (chat.ts Entry).
export function editMessage(store: ObjectStore, chat: string, message: Message, text: string) {
  const current = shown(message);
  return addEntry(store, chat, { type: 'version', message: message.id, replaces: current.id, edit: true, at: Date.now(), text, receipt: current.receipt });
}
