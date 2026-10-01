import type { Receipt } from './chat';

// A chat's long-term memory (design §6.2): one object per chat, at memoryId(chat). Memory as of its records, plus the
// chat's messages after them sent raw, is the whole chat; every automatic change is one update of this object, so two
// devices never both commit the same span.

// on: whether the chat summarizes and sends memory. budget: the tokens the 장기 기억 slot may take. window: the tokens of
// the latest messages, always sent raw and never summarized, in whole messages: one partly inside is inside, and the last
// is always raw. batch: the tokens of uncovered messages past the window that start a summary, and about the most one
// summary reads (at least one whole message). Tokens are counted as the prompt renders the messages.
export type MemorySettings = { on: boolean; budget: number; window: number; batch: number };

// The message version a record read.
export type Source = { message: string; version: string };

export type Line = { speaker: string; text: string };

// One run of consecutive messages, summarized. when and where are null when the story does not say; they are never
// invented. lines are kept word for word, each with its speaker. print: the fingerprint of the span as the prompt
// rendered it when it was read; a record is stale when the same span renders differently now. receipt: the call that
// wrote it, null for one the user wrote. edited and pinned (항상 넣기) are the user's, and automatic work never rewrites
// either. forgotten: the user deleted it; its span stays covered and sends nothing, and is not summarized again until
// the user asks. state: the facts it changed, each with its new value, or null for one it found no longer holds, so
// automatic work removes a fact only by a change a record names. opens and closes: the threads it opened and closed, as
// their text.
export type MemoryRecord = {
  id: string;
  sources: Source[];
  print: string;
  when: string | null;
  where: string | null;
  who: string[];
  what: string;
  lines: Line[];
  outcome: string;
  state: Change[];
  opens: string[];
  closes: string[];
  receipt: Receipt | null;
  at: number;
  edited?: true;
  pinned?: true;
  forgotten?: true;
};

export type Change = { about: string; field: string; value: string | null };

// The current value of one field about someone or something; the old value lives on in the record that changed it.
// record: the record that last set it, null when the user did.
export type Fact = { about: string; field: string; value: string; record: string | null };

// A promise, foreshadowing or event not yet resolved. opened: the record that opened it, null when the user did.
export type Thread = { id: string; text: string; opened: string | null };

// records in chat order.
export type Memory = { records: MemoryRecord[]; state: Fact[]; threads: Thread[] };

export const emptyMemory = (): Memory => ({ records: [], state: [], threads: [] });

// The chat's id with its first group's hex digits inverted: a UUID no device makes at random, the same on every
// device, so two devices creating a chat's memory at once meet in a version conflict instead of making two.
export const memoryId = (chat: string) => chat.replace(/^[0-9a-f]{8}/, (group) => [...group].map((digit) => (15 - parseInt(digit, 16)).toString(16)).join(''));
