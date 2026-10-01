/* eslint-disable @typescript-eslint/no-unused-vars -- signatures the memory core track fills; it deletes this line */
import type { Chat, Receipt } from '../model/chat';
import type { Stored } from '../model/kinds';
import { emptyMemory, memoryId, type Fact, type Memory, type MemoryRecord, type MemorySettings, type Thread } from '../model/memory';
import { SETTINGS_ID } from '../model/settings';
import type { ApiFailure, ApiResult } from './api';
import type { RouteFailure } from './assignment';
import type { Session } from './session';
import { without, type ObjectStore } from './store';

// The only writer of `memory` objects and of the memory settings (design §6.2).

export const MEMORY_DEFAULTS: MemorySettings = { on: true, budget: 25_000, window: 40, batch: 20 };

// own: the chat's 이 채팅만 따로, in place of the account's.
export type MemorySetup = MemorySettings & { own: boolean };

export function memorySetup(store: ObjectStore, chat: Chat): MemorySetup {
  if (chat.memory) return { ...chat.memory, own: true };
  return { ...MEMORY_DEFAULTS, ...store.get('settings', SETTINGS_ID)?.value.memory, own: false };
}

// null: 기본값으로 되돌리기.
export const setChatMemory = (store: ObjectStore, chat: string, settings: MemorySettings | null) =>
  store.update('chat', chat, (current) => (settings === null ? without(current, 'memory') : { ...current, memory: settings }));

export const setDefaultMemory = (store: ObjectStore, change: Partial<MemorySettings>) =>
  store.upsert('settings', (current) => ({ models: {}, ...current, memory: { ...current?.memory, ...change } }));

export const chatMemory = (store: ObjectStore, chat: string): Memory => store.get('memory', memoryId(chat))?.value ?? emptyMemory();

// The fields of a record the user can rewrite; an edit marks it edited.
export type RecordPatch = Partial<Pick<MemoryRecord, 'when' | 'where' | 'who' | 'what' | 'lines' | 'outcome'>>;

type Write<T = Stored<'memory'>> = Promise<ApiResult<T>>;

export function editRecord(_store: ObjectStore, _chat: string, _record: string, _patch: RecordPatch): Write {
  throw new Error('not built');
}

// 항상 넣기.
export function pinRecord(_store: ObjectStore, _chat: string, _record: string, _pinned: boolean): Write {
  throw new Error('not built');
}

// Answers the record as it was, which restoreRecord (되돌리기) writes back.
export function forgetRecord(_store: ObjectStore, _chat: string, _record: string): Write<MemoryRecord> {
  throw new Error('not built');
}

export function restoreRecord(_store: ObjectStore, _chat: string, _record: MemoryRecord): Write {
  throw new Error('not built');
}

// replaces: the about and field of the fact being rewritten, null for a new one.
export function setFact(_store: ObjectStore, _chat: string, _fact: Fact, _replaces: Pick<Fact, 'about' | 'field'> | null): Write {
  throw new Error('not built');
}

export function removeFact(_store: ObjectStore, _chat: string, _fact: Pick<Fact, 'about' | 'field'>): Write<Fact> {
  throw new Error('not built');
}

export function setThread(_store: ObjectStore, _chat: string, _thread: Thread): Write {
  throw new Error('not built');
}

export function removeThread(_store: ObjectStore, _chat: string, _thread: string): Write<Thread> {
  throw new Error('not built');
}

// sent: in the next request. stale: its messages render differently now, so it waits (design §6.2, When the source
// changes). over: past the budget. forgotten: the user deleted it.
export type RecordStatus = 'sent' | 'stale' | 'over' | 'forgotten';

// What the memory panel shows of one chat. slot: whether the chat's prompt holds 장기 기억 where a request reaches it.
// covered: the leading messages memory covers. waiting: messages past the window not summarized yet. tokens: what the
// slot sends against its budget, and the state's share against its limit.
export type MemoryView = {
  memory: Memory;
  setup: MemorySetup;
  slot: boolean;
  records: ReadonlyMap<string, RecordStatus>;
  covered: number;
  waiting: number;
  tokens: { used: number; budget: number; state: number; stateLimit: number };
};

export function memoryView(_session: Pick<Session, 'store' | 'read'>, _chat: string, _countTokens: (text: string) => number): MemoryView | null {
  throw new Error('not built');
}

// The messages the next request would leave out with no memory standing for them: covered by memory that is not sent,
// or cut by the model's budget. null while the chat cannot send.
export function leaving(_session: Session, _chat: string, _text: string, _countTokens: (text: string) => number): number | null {
  throw new Error('not built');
}

// invalid: the call answered, but not with records that pass validation (design §6.2, Validation); its receipt and why.
export type MemoryFailure =
  | RouteFailure
  | { kind: 'prompt-missing' }
  | { kind: 'profile-missing'; own: boolean }
  | { kind: 'tokenizer' }
  | { kind: 'failed'; receipt: Receipt }
  | { kind: 'invalid'; receipt: Receipt; reason: 'unreadable' | 'fields' | 'lines' }
  | { kind: 'unsaved'; failure: ApiFailure };

// running: the chats whose memory is being written, with the model writing it and the calls left. failed: why a
// chat's last summary did not enter memory, kept for the session so it is not tried again on its own.
export type Remembering = { running: ReadonlyMap<string, { model: string; left: number }>; failed: ReadonlyMap<string, MemoryFailure> };

// Summarizes chats in the background after replies are saved and when a chat opens (design §6.2, When summarizing runs).
export class Rememberer {
  private readonly listeners = new Set<() => void>();
  private readonly state: Remembering = { running: new Map(), failed: new Map() };

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = () => this.state;

  // 다시 시도 after a failure.
  retry(_chat: string) {
    throw new Error('not built');
  }

  // 원문에서 다시 만들기: one record from its source, or the whole chat's memory when record is null.
  rebuild(_chat: string, _record: string | null) {
    throw new Error('not built');
  }

  close() {}
}
