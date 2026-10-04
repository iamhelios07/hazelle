import type { Display } from '../engine/display';
import { chatTitle, previewLine, recentIn, shown, type ChatItem, type Summary } from '../model/chat';
import { live } from '../model/library';
import type { ApiFailure } from './api';
import type { ObjectStore } from './store';
import { pinned, scopeOf } from './turn';
import { pause } from './pause';

const VERSION = 1;
export type ChatModel = ChatItem & { display: Display };
// shown: the chat's overlay marks it was folded at. Never on Summary, which is saved: no write
// still unanswered ever reaches the server inside a summary.
export type Projection = { model: ChatModel; summary: Summary; shown: number };

// Like memoryId, a summary has one id under its chat, independent of which device builds it.
export const summaryId = (chat: string) => chat.replace(/[0-9a-f]/, (digit) => (parseInt(digit, 16) ^ 8).toString(16));

export function summaryStale(store: ObjectStore, id: string, summary: Summary, head = store.entryHead(id)): boolean {
  return summary.version !== VERSION || summary.chatRev !== store.get('chat', id)?.rev || summary.head < head
    || summary.dependencies.some((read) => store.revision(read) !== read.rev);
}

export async function projectChat(store: ObjectStore, id: string, signal?: AbortSignal): Promise<Projection | null> {
  const stored = live(store.get('chat', id));
  if (!stored) return null;
  const { messages, at } = store.foldedChat(id);
  const head = store.loadedHead(id);
  const marks = store.shownMark(id);
  const rendered = { now: Date.now(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  const { value: input, reads } = store.capture(() => ({ scope: { ...scopeOf({ store }, id, stored.value, messages), clock: rendered }, take: pinned({ store }, stored.value) }));
  const dependencies = [...new Map(reads.map((read) => [JSON.stringify(read), { ...read, rev: store.revision(read) }])).values()];
  const { display } = await store.evaluation.display(`projection:${id}`, input.scope, input.take, signal);
  // A message is named as the reader reads it: its translation when it has one.
  const texts = display.texts.map((text, index) => shown(messages[index]!).translation?.text ?? text);
  const last = texts.at(-1);
  const summary: Summary = {
    version: VERSION, head, chatRev: stored.rev, rendered,
    dependencies,
    character: stored.value.character, count: messages.length,
    title: chatTitle(stored.value, messages, texts).slice(0, 256),
    preview: last === undefined ? '' : previewLine(last).slice(0, 256),
    at, order: head || stored.rev, recent: recentIn(messages),
  };
  return { summary, model: { ...summary, id, chat: stored.value, messages, display }, shown: marks };
}

// One chat held at a time, so a pass over a whole account never holds more than one history. A chat with a summary is
// passed over: what rewrites a summary its chat outgrew is opening that chat (ObjectStore.retainChat), and a stopped
// restore carries on from the first chat it did not reach. An unreadable chat is passed over too; its screen says so.
export async function saveSummaries(store: ObjectStore, chats: Iterable<string>, signal = new AbortController().signal): Promise<ApiFailure | null> {
  for (const id of chats) {
    if (signal.aborted) return { ok: false, error: 'stopped' };
    if (store.get('summary', summaryId(id))) continue;
    const result = await store.withChat(id, async () => await store.saveSummary(id) ?? { ok: true, data: null }, signal);
    if (!result.ok && result.error !== 'unreadable') return result;
    if (!await pause(0, signal)) return { ok: false, error: 'stopped' };
  }
  return null;
}

// A chat lacks its summary when the write that follows its messages failed (ObjectStore.writeOne). Opening it writes one
// too, so this catches the chats nobody opens.
export const backfillSummaries = (store: ObjectStore, signal: AbortSignal) => saveSummaries(store, store.list('chat').filter(live).map(({ id }) => id), signal);
