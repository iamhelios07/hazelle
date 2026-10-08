import type { Receipt } from './chat';

// A chat's long-term memory (design §6.2): one object per chat, at memoryId(chat). Memory as of its records, plus the
// chat's messages after them sent raw, is the whole chat; every automatic change is one update of this object, so two
// devices never both commit the same span.

// budget: the tokens the 장기 기억 slot may take. window: the tokens of the latest messages, always sent raw and never
// summarized, in whole messages: one partly inside is inside, and the last is always raw. batch: the tokens of
// uncovered messages past the window that start a summary, and about the most one summary reads (at least one whole
// message). Tokens are counted as the prompt renders the messages.
export type MemorySettings = { on: boolean; budget: number; window: number; batch: number };

export type Source = { message: string; version: string };

export type Line = { speaker: string; text: string };

// when and where are null when the story does not say; they are never invented. lines are kept word for word, each
// with its speaker. print: the fingerprint of the span as the prompt rendered it when it was read; it is stale when the
// same span renders differently now. receipt: the call that wrote it, null for one the user wrote. edited and pinned
// (고정) are the user's, and automatic work never rewrites either. forgotten: the user deleted it; its span stays
// covered and sends nothing, and is not summarized again until the user asks.
export type Written = {
  id: string;
  sources: Source[];
  print: string;
  when: string | null;
  where: string | null;
  who: string[];
  what: string;
  lines: Line[];
  outcome: string;
  receipt: Receipt | null;
  at: number;
  edited?: true;
  pinned?: true;
  forgotten?: true;
};

// state: the facts it changed, each with its new value, or null for one it found no longer holds, so automatic work
// removes a fact only by a change a record names. opens and closes: the threads it opened and closed, as their text.
// recalled (이 기억 넣기): its messages are sent in its place while they fit, and it is the user's as pinned is.
export type MemoryRecord = Written & { state: Change[]; opens: string[]; closes: string[]; recalled?: true };

// Consecutive records summarized again from their messages, never from their text; a chapter is never folded into
// another. sources: the messages it read, from its first record's first to its last record's last. records: each with
// its at as the chapter read it; one changed, deleted or made again since makes the chapter wait for the user.
export type Chapter = Written & { records: { id: string; at: number }[] };

export type Change = { about: string; field: string; value: string | null };

// The old value lives on in the record that changed it. record: the record that last set it, null when the user did.
export type Fact = { about: string; field: string; value: string; record: string | null };

// opened: the record that opened it, null when the user did.
export type Thread = { id: string; text: string; opened: string | null };

// records and chapters in chat order.
export type Memory = { records: MemoryRecord[]; chapters: Chapter[]; state: Fact[]; threads: Thread[] };

export const emptyMemory = (): Memory => ({ records: [], chapters: [], state: [], threads: [] });

// The chat's id with its first group's hex digits inverted: a UUID no device makes at random, the same on every
// device, so two devices creating a chat's memory at once meet in a version conflict instead of making two.
export const memoryId = (chat: string) => chat.replace(/^[0-9a-f]{8}/, (group) => [...group].map((digit) => (15 - parseInt(digit, 16)).toString(16)).join(''));
