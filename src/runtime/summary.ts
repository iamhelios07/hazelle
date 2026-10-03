import type { Display } from '../engine/display';
import { chatTitle, fold, previewLine, recentIn, shown, type ChatItem, type Summary } from '../model/chat';
import { live } from '../model/library';
import type { ObjectStore } from './store';
import { displayChat } from './turn';
import { pause } from './pause';

const VERSION = 1;
export type ChatModel = ChatItem & { display: Display };
export type Projection = { model: ChatModel; summary: Summary };

// Like memoryId, a summary has one id under its chat, independent of which device builds it.
export const summaryId = (chat: string) => chat.replace(/[0-9a-f]/, (digit) => (parseInt(digit, 16) ^ 8).toString(16));

export function summaryStale(store: ObjectStore, id: string, summary: Summary, head = store.entryHead(id)): boolean {
  return summary.version !== VERSION || summary.chatRev !== store.get('chat', id)?.rev || summary.head < head
    || summary.dependencies.some((read) => store.revision(read) !== read.rev);
}

export function projectChat(store: ObjectStore, id: string, previous?: Projection): Projection | null {
  const stored = live(store.get('chat', id));
  if (!stored) return null;
  const entries = store.children('entry', id);
  const head = store.loadedHead(id);
  const messages = previous?.summary.head === head ? previous.model.messages : fold(entries);
  const rendered = { now: Date.now(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  const { value: display, reads } = store.capture(() => displayChat({ store }, id, stored.value, messages, null, rendered));
  const latest = entries.reduce<(typeof entries)[number] | null>((last, entry) => last && last.rev > entry.rev ? last : entry, null);
  // A message is named as the reader reads it: its translation when it has one.
  const texts = display.texts.map((text, index) => shown(messages[index]!).translation?.text ?? text);
  const last = texts.at(-1);
  const summary: Summary = {
    version: VERSION, head, chatRev: stored.rev, rendered,
    dependencies: [...new Map(reads.map((read) => [JSON.stringify(read), { ...read, rev: store.revision(read) }])).values()],
    character: stored.value.character, count: messages.length,
    title: chatTitle(stored.value, messages, texts).slice(0, 256),
    preview: last === undefined ? '' : previewLine(last).slice(0, 256),
    at: latest?.value.at ?? null, order: head || stored.rev, recent: recentIn(messages),
  };
  return { summary, model: { ...summary, id, chat: stored.value, messages, display } };
}

// A chat lacks its summary when the write that follows its messages failed (ObjectStore.writeOne). Opening it writes one
// too, so this catches the chats nobody opens.
export async function backfillSummaries(store: ObjectStore, signal: AbortSignal): Promise<void> {
  for (const { id } of store.list('chat').filter(live)) {
    if (signal.aborted) return;
    if (store.get('summary', summaryId(id))) continue;
    const result = await store.withChat(id, async () => await store.saveSummary(id) ?? { ok: true, data: null });
    if (!result.ok && result.error !== 'unreadable') return;
    if (!await pause(0, signal)) return;
  }
}
