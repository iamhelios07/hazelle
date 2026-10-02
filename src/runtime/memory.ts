import type { ModelSettings } from '../connectors/settings';
import type { Phase } from '../connectors/types';
import { coveredBy, fingerprint, memoryBudget, nextSpan, parseRecords, placesOf, staleness, standing, threadLabel, windowStart, type ChatRead, type Drafted, type MemoryInput, type RecordStatus, type Staleness } from '../engine/memory';
import { assembleMemory, type Assembled } from '../engine/pipeline';
import type { ChatScope } from '../engine/render';
import { renderChat } from '../engine/render';
import { shown, type Chat, type Message, type Receipt } from '../model/chat';
import type { Stored } from '../model/kinds';
import { emptyMemory, memoryId, type Fact, type Memory, type MemoryRecord, type MemorySettings, type Source, type Thread } from '../model/memory';
import type { MemoryPrompt } from '../model/prompt';
import { SETTINGS_ID } from '../model/settings';
import type { Stream } from '../model/stream';
import type { ApiFailure, ApiResult } from './api';
import { taskModel, type Route, type RouteFailure } from './assignment';
import { generate, resume, type Reply } from './generate';
import { modelProfile } from './profiles';
import { memoryPrompt } from './prompts';
import type { Session } from './session';
import { without, type ObjectStore } from './store';
import { callOf, endCall, newCall, type CallTarget } from './streams';
import { receiptOf } from './talk';
import { tokenizer } from './tokenizer';
import { asSent, promptBudget, scopeOf, wouldSend } from './turn';

export type { RecordStatus } from '../engine/memory';

// The only writer of `memory` objects and of the memory settings (design §6.2).

// budget, window and batch count tokens (model/memory MemorySettings).
export const MEMORY_DEFAULTS: MemorySettings = { on: true, budget: 25_000, window: 24_000, batch: 12_000 };

// own: the chat's 이 채팅만 따로, in place of the account's.
export type MemorySetup = MemorySettings & { own: boolean };

// The account's default, its absent fields filled from MEMORY_DEFAULTS.
export const defaultMemory = (store: ObjectStore): MemorySettings => ({ ...MEMORY_DEFAULTS, ...store.get('settings', SETTINGS_ID)?.value.memory });

export const memorySetup = (store: ObjectStore, chat: Chat): MemorySetup => (chat.memory ? { ...chat.memory, own: true } : { ...defaultMemory(store), own: false });

// null: 기본값으로 되돌리기.
export const setChatMemory = (store: ObjectStore, chat: string, settings: MemorySettings | null) =>
  store.update('chat', chat, (current) => (settings === null ? without(current, 'memory') : { ...current, memory: settings }));

export const setDefaultMemory = (store: ObjectStore, change: Partial<MemorySettings>) =>
  store.upsert('settings', (current) => ({ models: {}, ...current, memory: { ...current?.memory, ...change } }));

export const chatMemory = (store: ObjectStore, chat: string): Memory => store.children('memory', chat).find((entry) => entry.id === memoryId(chat))?.value ?? emptyMemory();

const sourcesOf = (messages: Message[]): Source[] => messages.map((message) => ({ message: message.id, version: shown(message).id }));

// What a turn's 장기 기억 slot is made from: messages are the turn's, as its scope holds them. null while memory is off.
export function memoryInput(store: ObjectStore, id: string, chat: Chat, messages: Message[]): MemoryInput | null {
  const setup = memorySetup(store, chat);
  return setup.on ? { memory: chatMemory(store, id), budget: setup.budget, shown: sourcesOf(messages) } : null;
}

type Write<T = Stored<'memory'>> = Promise<ApiResult<T>>;

// One update of the chat's memory, creating it the first time. change answers null when what it changes is not there,
// and nothing is written ('gone'). A create that meets another device's goes on as an update of that one.
async function changeMemory(store: ObjectStore, chat: string, change: (memory: Memory) => Memory | null): Write {
  return store.withChat(chat, async () => {
    const id = memoryId(chat);
    if (!store.children('memory', chat).find((entry) => entry.id === id)) {
      const value = change(emptyMemory());
      if (value === null) return { ok: false, error: 'gone' };
      const created = await store.create('memory', value, { id, parent: chat });
      if (created.ok || created.error !== 'conflict' || !store.children('memory', chat).find((entry) => entry.id === id)) return created;
    }
    return store.update('memory', id, change);
  });
}

const withRecord = (store: ObjectStore, chat: string, id: string, change: (record: MemoryRecord) => MemoryRecord) =>
  changeMemory(store, chat, (memory) => {
    const at = memory.records.findIndex((record) => record.id === id);
    return at === -1 ? null : { ...memory, records: memory.records.with(at, change(memory.records[at]!)) };
  });

// The fields of a record the user can rewrite; an edit marks it edited.
export type RecordPatch = Partial<Pick<MemoryRecord, 'when' | 'where' | 'who' | 'what' | 'lines' | 'outcome'>>;

// at moves too, so a summary of the record started before the edit is refused.
export const editRecord = (store: ObjectStore, chat: string, record: string, patch: RecordPatch): Write =>
  withRecord(store, chat, record, (current) => ({ ...current, ...patch, edited: true, at: Date.now() }));

// 항상 넣기. A pinned record is sent even when stale, which is how the user keeps one as canon (그래도 넣기).
export const pinRecord = (store: ObjectStore, chat: string, record: string, pinned: boolean): Write =>
  withRecord(store, chat, record, (current) => (pinned ? { ...current, pinned: true } : without(current, 'pinned')));

// A deletion that answers what it deleted, for its 되돌리기. The store applies a change again when a try's answer was
// lost after it landed (ObjectStore reaching), and that copy no longer holds the thing: the snapshot stays the last
// copy's that held it, and the deletion already made, by that try or by another device, is this one done.
async function taking<T>(store: ObjectStore, chat: string, find: (memory: Memory) => T | undefined, remove: (memory: Memory, found: T) => Memory): Write<T> {
  let was: T | undefined;
  const saved = await changeMemory(store, chat, (memory) => {
    const found = find(memory);
    if (found === undefined) return was === undefined ? null : memory;
    was = found;
    return remove(memory, found);
  });
  return saved.ok ? { ok: true, data: was! } : saved;
}

// Answers the record as it was, which restoreRecord (되돌리기) writes back.
export const forgetRecord = (store: ObjectStore, chat: string, record: string): Write<MemoryRecord> =>
  taking(
    store,
    chat,
    (memory) => memory.records.find(({ id, forgotten }) => id === record && !forgotten),
    (memory, found) => ({ ...memory, records: memory.records.map((each) => (each === found ? { ...found, forgotten: true } : each)) }),
  );

export const restoreRecord = (store: ObjectStore, chat: string, record: MemoryRecord): Write => withRecord(store, chat, record.id, () => record);

const sameFact = (a: Pick<Fact, 'about' | 'field'>, b: Pick<Fact, 'about' | 'field'>) => a.about === b.about && a.field === b.field;

// replaces: the about and field of the fact being rewritten, null for a new one. A fact the user writes names no record.
export function setFact(store: ObjectStore, chat: string, fact: Fact, replaces: Pick<Fact, 'about' | 'field'> | null): Write {
  const key = replaces ?? fact;
  const written = { ...fact, record: null };
  return changeMemory(store, chat, (memory) => {
    const kept = memory.state.filter((each) => !sameFact(each, fact) || sameFact(each, key));
    const at = kept.findIndex((each) => sameFact(each, key));
    return { ...memory, state: at === -1 ? [...kept, written] : kept.with(at, written) };
  });
}

export const removeFact = (store: ObjectStore, chat: string, fact: Pick<Fact, 'about' | 'field'>): Write<Fact> =>
  taking(
    store,
    chat,
    (memory) => memory.state.find((each) => sameFact(each, fact)),
    (memory, found) => ({ ...memory, state: memory.state.filter((each) => each !== found) }),
  );

export const setThread = (store: ObjectStore, chat: string, thread: Thread): Write =>
  changeMemory(store, chat, (memory) => {
    const at = memory.threads.findIndex(({ id }) => id === thread.id);
    return { ...memory, threads: at === -1 ? [...memory.threads, thread] : memory.threads.with(at, thread) };
  });

export const removeThread = (store: ObjectStore, chat: string, thread: string): Write<Thread> =>
  taking(
    store,
    chat,
    (memory) => memory.threads.find(({ id }) => id === thread),
    (memory, found) => ({ ...memory, threads: memory.threads.filter((each) => each !== found) }),
  );

// A saved chat as memory reads it: its messages as a request sends them, and their texts as the prompt renders them.
type ChatSent = { chat: Chat; scope: ChatScope; read: ChatRead };

function chatSent(session: Pick<Session, 'store' | 'read'>, id: string): ChatSent | null {
  const stored = session.store.get('chat', id);
  const model = session.read.chat(id).snapshot();
  if (!stored || !model) return null;
  const messages = asSent(session.store, stored.value, model.messages);
  const scope = scopeOf(session, id, stored.value, messages);
  return { chat: stored.value, scope, read: { shown: sourcesOf(messages), roles: messages.map(({ role }) => role), texts: renderChat('prompt', scope).texts } };
}

const tokensOf = (read: ChatRead, countTokens: (text: string) => number) => read.texts.map((text) => countTokens(text.trim()));

// What the memory panel shows of one chat. slot: whether the chat's prompt holds 장기 기억 where a request reaches it,
// false while the chat cannot send. stale: why each stale record is, a record the user edited or pinned included, which
// stays sent. covered: the leading messages memory covers. waiting: messages past the window not summarized yet. tokens:
// what the slot sends against its budget (shrunk to what the model can take), and the state's share against its limit.
export type MemoryView = {
  memory: Memory;
  setup: MemorySetup;
  slot: boolean;
  records: ReadonlyMap<string, RecordStatus>;
  stale: ReadonlyMap<string, Staleness>;
  covered: number;
  waiting: number;
  tokens: { used: number; budget: number; state: number; stateLimit: number };
};

export function memoryView(session: Pick<Session, 'store' | 'read'>, chat: string, countTokens: (text: string) => number): MemoryView | null {
  const sent = chatSent(session, chat);
  if (!sent) return null;
  const setup = memorySetup(session.store, sent.chat);
  const memory = chatMemory(session.store, chat);
  const held = standing(memory, sent.read, memoryBudget(setup.budget, promptBudget(session.store, sent.chat)), countTokens);
  return {
    memory,
    setup,
    slot: wouldSend(session, chat, { kind: 'answer' }, countTokens)?.prompt.memory?.slot ?? false,
    records: held.status,
    stale: held.stale,
    covered: held.covered,
    waiting: Math.max(windowStart(tokensOf(sent.read, countTokens), setup.window) - held.covered, 0),
    tokens: held.tokens,
  };
}

// The messages a request leaves out with no memory standing for them: covered by memory that is not sent, or cut by
// the model's budget.
export const leaving = (prompt: Assembled): number => (prompt.memory?.missing ?? 0) + prompt.dropped;

// One summary: the message versions it reads, in chat order, and the record it summarizes again as it was when the job
// started (at), null for the messages after memory's end. user: the user asked, and may have a record they edited or
// pinned, or forgot, summarized again.
type Job = { sources: Source[]; redo: { record: string; at: number; user: boolean } | null };

// Whether a job's result may enter memory now: the versions it read are still the ones shown, and memory still ends
// where the job started, or the record it summarizes again is as it was. messages: the chat's, as they fold now.
function applies(memory: Memory, messages: Message[], { sources, redo }: Job): boolean {
  const places = placesOf(sourcesOf(messages));
  const showing = sources.every(({ message, version }) => {
    const at = places.get(message);
    return at !== undefined && shown(messages[at]!).id === version;
  });
  if (!showing) return false;
  if (!redo) return coveredBy(memory, places) === places.get(sources[0]!.message);
  const record = memory.records.find(({ id }) => id === redo.record);
  return record !== undefined && record.at === redo.at && (redo.user || (!record.edited && !record.pinned && !record.forgotten));
}

// The job's records in place of the one it summarized again, or after memory's end, with the state they change (a null
// value removes the fact) and the threads they open and close, each kept on the record that made it. A fact a later
// record or the user set stays as it is. span: the messages read, as the prompt rendered them; first: the id of the first
// record, which tells a call already saved (Streams).
function committed(memory: Memory, { sources, redo }: Job, drafts: Drafted[], span: { role: string; text: string }[], receipt: Receipt, first: string): Memory {
  const at = Date.now();
  let from = 0;
  const open = [...memory.threads];
  const made = drafts.map(({ to, when, where, who, what, lines, outcome, state, opens, closes }, index): MemoryRecord => {
    const closed = open.filter((thread) => closes.includes(threadLabel(thread))).map(({ text }) => text);
    const record = { id: index === 0 ? first : crypto.randomUUID(), sources: sources.slice(from, to), print: fingerprint(span.slice(from, to)), when, where, who, what, lines, outcome, state, opens, closes: closed, receipt, at };
    from = to;
    return record;
  });
  const place = redo ? memory.records.findIndex(({ id }) => id === redo.record) : memory.records.length;
  const records = [...memory.records.slice(0, place), ...made, ...memory.records.slice(redo ? place + 1 : place)];
  const later = new Set(records.slice(place + made.length).map(({ id }) => id));
  let state = redo ? memory.state.filter(({ record }) => record !== redo.record) : memory.state;
  let threads = redo ? memory.threads.filter(({ opened }) => opened !== redo.record) : memory.threads;
  drafts.forEach((draft, index) => {
    const record = made[index]!.id;
    for (const { about, field, value } of draft.state) {
      const at = state.findIndex((fact) => sameFact(fact, { about, field }));
      const held = state[at];
      if (held && (held.record === null || later.has(held.record))) continue;
      if (value === null) state = state.filter((fact) => fact !== held);
      else state = at === -1 ? [...state, { about, field, value, record }] : state.with(at, { about, field, value, record });
    }
    const kept = threads.filter((thread) => !draft.closes.includes(threadLabel(thread)));
    // A thread already open, said again, stays one thread.
    const known = new Set(kept.map(({ text }) => sameText(text)));
    threads = [...kept, ...draft.opens.filter((text) => !known.has(sameText(text))).map((text) => ({ id: crypto.randomUUID(), text, opened: record }))];
  });
  return { records, state, threads };
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

// A job ready to call: what it reads, through which prompt and model, and the calls likely left after it.
type Planned = { job: Job; sent: ChatSent; from: number; to: number; memory: Memory; before: MemoryRecord | null; prompt: MemoryPrompt; route: Route; settings: ModelSettings; left: number };

// done: committed. moved: memory or the messages changed while the call ran, so its result was dropped and the next job
// reads them as they are now. stopped: the session closed; the call's marker stays for the next load.
type Outcome = 'done' | 'moved' | 'stopped' | MemoryFailure;

// Summarizes chats in the background after replies are saved, when a chat opens, and when an edit or a version switch
// makes a record stale (design §6.2, When summarizing runs). One job at a time per chat, so each span reads the state the
// one before it left. It never blocks or cancels a send.
export class Rememberer {
  private closed = false;
  private state: Remembering = { running: new Map(), failed: new Map() };
  private readonly listeners = new Set<() => void>();
  // The chats with a job running, and of those the ones that may summarize new messages too, not only stale records.
  private readonly working = new Set<string>();
  private readonly full = new Set<string>();
  // The record the user asked to summarize again, by chat.
  private readonly asked = new Map<string, string>();
  // The message versions a stale record was summarized again from this session. One that renders differently each
  // time it is read ({{time}}, or CBS reading later messages) stays stale, and is not summarized again from the same
  // versions, which would pay for a call on every check.
  private readonly reread = new Set<string>();
  // The calls ended here. A memory result is not always saved (a refused one is dropped), so a marker that lands after
  // its call ended (newCall writes it without waiting) cannot be told by its result, as a reply's is.
  private readonly ended = new Set<string>();
  private readonly aborts = new Set<AbortController>();
  private readonly stop: () => void;

  constructor(
    private readonly session: Pick<Session, 'store' | 'read' | 'credentials'>,
    // The calls this page reads (runtime/streams), shared with Talk, Translator and Streams.
    private readonly reading: Set<string>,
  ) {
    // Another device's reply arrives here as entries too; only the device that saved it summarizes new messages, so two
    // open devices do not pay for the same span.
    this.stop = session.store.subscribe((changes) => {
      for (const chat of new Set(changes.flatMap(({ kind, parent }) => (kind === 'entry' && parent ? [parent] : [])))) this.start(chat, false);
    });
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = () => this.state;

  // After a reply is saved, and when a chat opens.
  check(chat: string) {
    this.start(chat, true);
  }

  // 다시 시도 after a failure.
  retry(chat: string) {
    this.change(chat, { failed: null });
    this.start(chat, true);
  }

  // 원문에서 다시 만들기: one record from its source, or the whole chat's memory when record is null, which starts over
  // from no memory at all.
  rebuild(chat: string, record: string | null) {
    this.change(chat, { failed: null });
    if (record === null) {
      this.asked.delete(chat);
      void changeMemory(this.session.store, chat, () => emptyMemory()).then(() => this.start(chat, true));
      return;
    }
    this.asked.set(chat, record);
    this.start(chat, true);
  }

  // A summary the server was making when this page came, which Streams hands over. Waits while the chat has a job
  // running; the next pick-up offers it again.
  resume(stream: Stored<'stream'>) {
    const chat = stream.parent!;
    const purpose = stream.value.for;
    if (this.ended.has(stream.id)) return endCall(this.session.store, stream.id);
    if (this.closed || purpose.kind !== 'memory' || this.working.has(chat)) return;
    this.working.add(chat);
    this.change(chat, { running: { model: stream.value.call.modelName, left: 1 } });
    void this.hold(chat, () => this.resumed(chat, stream, purpose)).finally(() => this.done(chat));
  }

  close() {
    this.closed = true;
    this.stop();
    for (const abort of this.aborts) abort.abort();
  }

  private change(chat: string, change: { running?: { model: string; left: number } | null; failed?: MemoryFailure | null }) {
    const next = { running: new Map(this.state.running), failed: new Map(this.state.failed) };
    if (change.running === null) next.running.delete(chat);
    else if (change.running) next.running.set(chat, change.running);
    if (change.failed === null) next.failed.delete(chat);
    else if (change.failed) next.failed.set(chat, change.failed);
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  private start(chat: string, full: boolean) {
    if (this.closed || this.state.failed.has(chat) || (!full && this.session.store.scopeState(chat) !== 'loaded')) return;
    if (this.working.has(chat)) {
      if (full) this.full.add(chat);
      return;
    }
    const stored = this.session.store.get('chat', chat);
    if (!stored || !memorySetup(this.session.store, stored.value).on || (!full && !chatMemory(this.session.store, chat).records.length)) return;
    if (full) this.full.add(chat);
    this.working.add(chat);
    void this.hold(chat, () => this.work(chat)).finally(() => this.done(chat));
  }

  private async hold(chat: string, work: () => Promise<unknown>) {
    const lease = this.session.store.retainChat(chat);
    try {
      const failure = await lease.ready;
      if (failure) return this.change(chat, { failed: { kind: 'unsaved', failure } });
      if (!this.closed) await work();
    } finally { lease.release(); }
  }

  private done(chat: string) {
    this.working.delete(chat);
    this.full.delete(chat);
    this.change(chat, { running: null });
  }

  private async work(chat: string) {
    const countTokens = await tokenizer().catch(() => null);
    if (!countTokens) return this.change(chat, { failed: { kind: 'tokenizer' } });
    while (!this.closed) {
      const planned = this.plan(chat, countTokens);
      if (!planned) return;
      if ('kind' in planned) return this.change(chat, { failed: planned });
      this.change(chat, { running: { model: planned.route.model.name, left: planned.left } });
      const outcome = await this.summarize(chat, planned, countTokens);
      if (planned.job.redo) this.reread.add(readKey(planned.job.sources));
      if (outcome === 'stopped') return;
      if (typeof outcome !== 'string') return this.change(chat, { failed: outcome });
    }
  }

  // The next job, first the record the user asked for, then a stale automatic record, then new messages. A record one
  // of whose messages was deleted waits for the user.
  private plan(chat: string, countTokens: (text: string) => number): Planned | MemoryFailure | null {
    const { store } = this.session;
    const sent = chatSent(this.session, chat);
    if (!sent) return null;
    const setup = memorySetup(store, sent.chat);
    if (!setup.on) return null;
    const memory = chatMemory(store, chat);
    const places = placesOf(sent.read.shown);
    const asked = memory.records.find(({ id }) => id === this.asked.get(chat));
    this.asked.delete(chat);
    const stale = memory.records.filter((record) => !record.edited && !record.pinned && !record.forgotten && staleness(record, sent.read, places) === 'changed' && !this.reread.has(readKey(shownFor(record, sent.read, places))));
    // Without a 장기 기억 slot in the request, a new record would only take its messages out of it, and a stale one
    // summarized again would be paid for and never read. What the user asked for is made whatever the prompt holds.
    let slot: boolean | null = null;
    const reaches = () => (slot ??= wouldSend(this.session, chat, { kind: 'answer' }, countTokens)?.prompt.memory?.slot === true);
    const again = asked ?? (stale.length && reaches() ? stale[0] : undefined);
    const span = !again && this.full.has(chat) && reaches() ? this.span(chat, sent.read, coveredBy(memory, places), setup, countTokens) : null;
    if (!again && !span) return null;
    const indices = again ? again.sources.flatMap(({ message }) => places.get(message) ?? []) : [];
    if (again && !indices.length) return null;
    const [from, to] = span ? [span.from, span.to] : [Math.min(...indices), Math.max(...indices) + 1];
    const job: Job = { sources: sent.read.shown.slice(from, to), redo: again ? { record: again.id, at: again.at, user: again === asked } : null };

    const prompt = memoryPrompt(store);
    if (prompt.kind === 'missing') return { kind: 'prompt-missing' };
    const route = taskModel(store, sent.chat, prompt.prompt.value.model);
    if ('kind' in route) return route;
    const profile = modelProfile(store, route.model);
    if (profile.kind === 'missing') return { kind: 'profile-missing', own: profile.own };
    const place = again ? memory.records.indexOf(again) : memory.records.length;
    const before = memory.records.slice(0, place).findLast((record) => !record.forgotten) ?? null;
    const waiting = span ? Math.ceil(span.waiting / setup.batch) : 0;
    return { job, sent, from, to, memory, before, prompt: prompt.prompt.value, route, settings: profile.profile.value.settings, left: Math.max(stale.length + waiting, 1) };
  }

  // New messages to summarize, by their tokens as the prompt renders them; earlier than batch when the next request
  // drops messages for want of room.
  private span(chat: string, read: ChatRead, covered: number, setup: MemorySettings, countTokens: (text: string) => number) {
    const tokens = tokensOf(read, countTokens);
    const end = windowStart(tokens, setup.window);
    if (end <= covered) return null;
    const waiting = tokens.slice(covered, end).reduce((sum, count) => sum + count, 0);
    const dropped = waiting < setup.batch ? (wouldSend(this.session, chat, { kind: 'answer' }, countTokens)?.prompt.dropped ?? 0) : 0;
    const span = nextSpan(tokens, covered, setup, dropped);
    return span && { ...span, waiting };
  }

  private async summarize(chat: string, { job, sent, from, to, memory, before, prompt, route, settings }: Planned, countTokens: (text: string) => number): Promise<Outcome> {
    const { store, credentials } = this.session;
    const budget = memoryBudget(memorySetup(store, sent.chat).budget, promptBudget(store, sent.chat));
    const { messages, span } = assembleMemory({ scope: sent.scope, prompt, memory, before, budget, span: { from, to }, seed: crypto.randomUUID(), countTokens });
    const read = span.map((each, offset) => ({ role: sent.read.roles[from + offset]!, text: each }));
    const target: CallTarget = { id: crypto.randomUUID(), chat, result: crypto.randomUUID(), for: { kind: 'memory', sources: job.sources, print: fingerprint(read) } };
    const text = gather();
    const answer = await this.reads(target.id, async (signal) =>
      generate({ credentials, connection: route.connection.value, model: route.model, settings, messages, call: await newCall(store, route, target), signal, onText: text.add }),
    );
    return this.finish(chat, target.id, target.result, callOf(route), answer, text.value(), job, read);
  }

  // A resumed call's answer is for its span as the prompt rendered it when the call was made (the marker's print).
  // Rendered differently now, after a toggle or a variable an earlier message sets, the answer is dropped as one whose
  // versions changed is: its key lines cannot be checked against a text the call never read, and its records would
  // take the print of that text and never read as stale.
  private async resumed(chat: string, stream: Stored<'stream'>, { sources, print }: Extract<Stream['for'], { kind: 'memory' }>) {
    const text = gather();
    const answer = await this.reads(stream.id, (signal) => resume(this.session.store, stream, signal, text.add));
    const sent = chatSent(this.session, chat);
    const places = placesOf(sent?.read.shown ?? []);
    const indices = sources.flatMap(({ message }) => places.get(message) ?? []);
    const read = indices.map((index) => ({ role: sent!.read.roles[index]!, text: sent!.read.texts[index]! }));
    if (indices.length < sources.length || fingerprint(read) !== print) {
      if (answer.cut !== 'stopped') endCall(this.session.store, stream.id);
      return;
    }
    const memory = chatMemory(this.session.store, chat);
    const again = memory.records.find((record) => {
      const present = record.sources.filter(({ message }) => places.has(message));
      return present.length === sources.length && present.every(({ message }, index) => message === sources[index]!.message);
    });
    const job: Job = { sources, redo: again ? { record: again.id, at: again.at, user: false } : null };
    const outcome = await this.finish(chat, stream.id, stream.value.result, stream.value.call, answer, text.value(), job, read);
    if (typeof outcome !== 'string') this.change(chat, { failed: outcome });
  }

  private async reads(id: string, call: (signal: AbortSignal) => Promise<Reply>): Promise<Reply> {
    const abort = new AbortController();
    this.aborts.add(abort);
    this.reading.add(id);
    try {
      return await call(abort.signal);
    } finally {
      this.reading.delete(id);
      this.aborts.delete(abort);
    }
  }

  // The commit's check runs inside the update, so a version conflict pulls and checks again against the newer memory.
  // A record keeps its call's receipt without a pending cost: memory calls' costs are not settled yet.
  private async finish(chat: string, id: string, first: string, call: Parameters<typeof receiptOf>[0], answer: Reply, text: string, job: Job, span: { role: string; text: string }[]): Promise<Outcome> {
    if (answer.cut === 'stopped') return 'stopped';
    const { store } = this.session;
    const made = receiptOf(call, answer);
    const receipt = made.cost === 'pending' ? { ...made, cost: null } : made;
    const outcome = await (async (): Promise<Outcome> => {
      if (answer.state !== 'done') return { kind: 'failed', receipt };
      const parsed = parseRecords(text, span.map(({ text }) => text));
      if (!parsed.ok) return { kind: 'invalid', receipt, reason: parsed.reason };
      const saved = await changeMemory(store, chat, (memory) => {
        const messages = store.projection(chat)?.model.messages;
        return messages && applies(memory, messages, job) ? committed(memory, job, parsed.records, span, receipt, first) : null;
      });
      return saved.ok ? 'done' : saved.error === 'gone' ? 'moved' : { kind: 'unsaved', failure: saved };
    })();
    endCall(store, id);
    this.ended.add(id);
    return outcome;
  }
}

const sameText = (text: string) => text.replace(/\s+/g, ' ').trim();

const readKey = (sources: Source[]) => sources.map(({ message, version }) => `${message}/${version}`).join(' ');

// The versions shown now of a record's messages that are still in the chat.
const shownFor = (record: MemoryRecord, read: ChatRead, places: ReadonlyMap<string, number>) => record.sources.flatMap(({ message }) => {
  const at = places.get(message);
  return at === undefined ? [] : [read.shown[at]!];
});

function gather() {
  let text = '';
  return {
    add: (phase: Phase, chunk: string) => {
      if (phase === 'text') text += chunk;
    },
    value: () => text,
  };
}
