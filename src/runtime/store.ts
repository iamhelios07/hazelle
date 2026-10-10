import { ChangeSignal } from '../change-signal';
import { ChatFold } from '../model/chat';
import { KINDS, parentKinds, type AppendOnly, type Kind, type Singleton, type Stored, type Values } from '../model/kinds';
import { objectKey } from '../vault/objects';
import type { VaultKey } from '../vault/keys';
import type { ApiFailure, ApiResult, api as realApi } from './api';
import { pause } from './pause';
import { CodecAborted, CodecUnavailable, ObjectCodec, OPEN_BYTES, OPEN_ITEMS, SEAL_ITEMS } from './object-codec';
import { codecValue, type CodecResult, type OpenItem, type SealItem } from './object-codec-core';
import { orderOwned } from './removal';
import { GenerationChanged, SCOPED, type CachedScope, type CacheState, type CacheWrite, type DeviceCache, type Generation, type SealedChange } from './object-cache';
import { Evaluation, EvaluationFailed, EvaluationStopped, EvaluationStuck } from './evaluation';
import { ChatProjections } from './summary';
import { ScopeUnavailable, type ChatLease, type ScopeState } from './chat-scope';
import { upgradeValue } from './upgrade';

type Api = typeof realApi;
export type ObjectRow = { id: string; kind: string; parent: string | null; rev: number };
export type StoreChange = { kind: string; id: string; parent: string | null };
export type StoreRead = { kind: Kind; id: string } | { kind: Kind; list: true } | { kind: Kind; parent: string };
// total: what the whole bootstrap holds, once its first page said; an incremental pull has none.
export type PullProgress = { objects: number; pages: number; waiting: boolean; total?: number };
type PullOptions = { signal?: AbortSignal; progress?: (progress: PullProgress) => void };

export const readsChanged = (reads: StoreRead[], changes: readonly StoreChange[]) =>
  reads.some((read) => changes.some((change) => read.kind === change.kind && ('list' in read || ('id' in read ? read.id === change.id : read.parent === change.parent))));

type Limits = { items: number; bytes: number; body: number };
type Page = { timeline: string; until?: number; changes: SealedChange[]; cursor: number; more: boolean; limits: Limits; total?: number };
export type Pin = { timeline: string; epoch: number };
const changed = (): ApiFailure => ({ ok: false, error: 'timeline-changed' });
type ObjectValue = Omit<Stored<Kind>, 'rev' | 'pending'>;
export type Write = (ObjectValue & { type: 'create' | 'restore' }) | { type: 'remove'; id: string };
type Pending = { id: string; kind: string; parent: string | null; value: unknown; baseRev: number | null };
type Resolved = { pending: Pending | null; held: Held | null };
// derived: a write the store makes on its own (a summary), which is not counted among the person's dropped writes and
// not shown before its answer. at: the copy a change applies to, live when sent and what reads show when previewed.
type Step = { id: string; resolve: (at: (id: string) => Held | undefined) => ApiResult<Resolved>; derived?: boolean };

// value is undefined for a body that did not open. Such an object is counted, never
// shown as if it were empty, and never overwritten. kind may be one a newer version wrote.
type Held = { id: string; kind: string; parent: string | null; rev: number; value: unknown; pending?: number };
// A write sent and not yet answered, which every read shows over live (held null: a removal). Pending is a state of its
// own, never a rev: live, deleted, revisions and heads stay confirmed-only, and the pull cursors and cache bounds with
// them (user, 2026-10-04: the screen leads, the network follows).
type Overlay = { id: string; kind: string; parent: string | null; held: Held | null };
const chatOf = ({ id, kind, parent }: Overlay) => (kind === 'chat' ? id : SCOPED.has(kind) ? parent : null);

// false when stop ends the wait first.
async function waited(work: Promise<unknown>, stop: AbortSignal): Promise<boolean> {
  if (stop.aborted) return false;
  let quit = () => {};
  const stopped = new Promise<false>((resolve) => {
    quit = () => resolve(false);
    stop.addEventListener('abort', quit, { once: true });
  });
  try {
    return await Promise.race([work.then(() => true as const), stopped]);
  } finally {
    stop.removeEventListener('abort', quit);
  }
}

const MAX_ATTEMPTS = 3;
const encoder = new TextEncoder();
// Pauses between tries of a write that could not reach the server; the last repeats until it does.
const RECONNECT_PAUSES = [1000, 2000, 4000, 8000, 15000];
// A call waits these out as it waits for a dropped connection; a 503 says when to try again (retryAfter, in seconds).
// busy: the server's upload slots are all taken (server/files).
const WAITED = new Set(['offline', 'account-restoring', 'store-unavailable', 'busy']);
const waits = (result: ApiResult<unknown> | null): result is ApiFailure => result?.ok === false && WAITED.has(result.error);
type Scope = { fold: ChatFold; opening: Promise<ApiFailure | null> | null; abort: AbortController; state: ScopeState; users: number; cursor: number; head: number; loading: Promise<ApiFailure | null> | null; error: ApiFailure | null; summarize: boolean };
// The server stays the only source of truth: writes go to it first, and a version conflict is resolved by pulling the
// newer copy and applying the change again on top of it.
export class ObjectStore {
  private readonly closing = new AbortController();
  private readonly live = new Map<string, Held>();
  private readonly overlays = new Map<string, Overlay>();
  private readonly marks = new Map<string, number>();
  private shownCount = 0;
  // Per id, the commit last called to write it: a later one sends only once the earlier has ended, so writes to one
  // object land in call order and a later overlay is never replaced by an earlier answer.
  private readonly claims = new Map<string, Promise<void>>();
  private readonly deleted = new Map<string, number>();
  private readonly byKind = new Map<string, Set<string>>();
  private readonly byParent = new Map<string, Map<string, Set<string>>>();
  private unreadableCount = 0;
  private readonly upgraded = new Map<string, string>();
  private readonly listeners = new Set<(changes: readonly StoreChange[]) => void>();
  private readonly waitChanges = new ChangeSignal();
  private waitingCalls = 0;
  private readonly changes: StoreChange[] = [];
  private reading: StoreRead[] | null = null;
  private cursor = 0;
  private bootstrap: number | null = null;
  private bootstrapped = false;
  private readonly scopes = new Map<string, Scope>();
  private readonly heads = new Map<string, number>();
  private readonly revisions = new Map<string, number>();
  readonly evaluation = new Evaluation({ verdict: (chat) => this.unrecorded(() => this.projections.verdict(chat) !== null), judged: (chat) => this.projections.judge(chat) });
  readonly projections: ChatProjections;
  private readonly behind = new Set<string>();
  private limits: Limits | null = null;
  private pulling: Promise<ApiFailure | null> | null = null;
  private caching: Promise<void> = Promise.resolve();
  private cacheFailed = false;
  // The server's token for the account's history (server/account-store), replaced by every restore there. Sent with
  // every feed and batch, adopted only from the answer to a bootstrap sent with none, and cleared by reset.
  private timeline: string | null = null;
  // The local generation, not the server's timeline: every reset ends one, and work begun in it is cancelled.
  private epoch = 0;
  private ended = new AbortController();
  private generation: Generation | null = null;
  // A reload from the cache after another tab moved its generation, which a pull waits for before its next request.
  private opening: Promise<void> | null = null;
  private readonly unsent = new Set<() => number>();
  private readonly workflows = new Set<Pin>();
  private readonly rewoundListeners = new Set<(dropped: number) => void>();
  private known = 0;
  private restored = false;
  private openingFailure: ApiFailure | null = null;
  private readonly codec: ObjectCodec;

  private constructor(
    accountId: string,
    key: CryptoKey,
    private readonly request: Api,
    private readonly cache?: DeviceCache,
  ) {
    this.codec = new ObjectCodec(accountId, key);
    this.projections = new ChatProjections({
      get: (kind, id) => this.get(kind, id),
      children: (kind, parent) => this.children(kind, parent),
      scopeState: (chat) => this.scopeState(chat),
      capture: (read) => this.capture(read),
      revision: (read) => this.revision(read),
      foldedChat: (chat) => this.foldedChat(chat),
      entryHead: (chat) => this.entryHead(chat),
      loadedHead: (chat) => this.loadedHead(chat),
      shownMark: (chat) => this.shownMark(chat),
    }, this.evaluation, {
      epoch: () => this.epoch,
      ending: () => this.ended.signal,
      closing: this.closing.signal,
      scope: (chat) => {
        const scope = this.scopes.get(chat);
        return scope && { signal: scope.abort.signal, state: scope.state, loading: scope.loading, error: scope.error };
      },
      held: () => this.scopes.keys(),
      showing: (chat) => this.showing(chat),
      refresh: (chat) => this.refreshChat(chat),
      retain: (chat) => this.retainChat(chat),
      write: async (writes, signal) => {
        const result = await this.commit(writes.map((write) => this.step(write)), undefined, signal);
        return result.ok ? null : result;
      },
      publish: (chat) => {
        this.changes.push({ kind: 'projection', id: chat, parent: chat });
        this.changed();
      },
      fail: (chat, signal, epoch, error) => {
        const scope = this.scopes.get(chat);
        return scope?.abort.signal === signal ? this.failScope(chat, scope, epoch, error) : this.codecFailure(error, epoch);
      },
      failure: (error, epoch) => this.codecFailure(error, epoch),
      halted: (epoch) => this.halted(epoch),
    });
  }

  static async open(accountId: string, vaultKey: VaultKey, request: Api, cache?: DeviceCache, signal?: AbortSignal): Promise<ObjectStore> {
    const store = new ObjectStore(accountId, await objectKey(vaultKey), request, cache);
    await store.load(store.epoch, signal);
    return store;
  }

  private async load(epoch: number, signal?: AbortSignal) {
    if (!this.cache || this.cacheFailed) return;
    const stop = AbortSignal.any([this.closing.signal, this.ended.signal, ...(signal ? [signal] : [])]);
    try {
      const { generation, saved } = await this.cache.open();
      if (epoch !== this.epoch) return;
      this.generation = generation;
      this.timeline = generation.timeline;
      if (!saved) return;
      const { state } = saved;
      this.cursor = state.cursor;
      this.bootstrap = state.until;
      this.bootstrapped = state.complete;
      this.limits = state.limits;
      for (const [chat, head] of state.heads) this.heads.set(chat, head);
      for (const [read, rev] of state.revisions) this.revisions.set(read, rev);
      this.known = Math.max(state.cursor, state.until ?? 0);
      for (const [, rev] of [...state.heads, ...state.revisions]) this.known = Math.max(this.known, rev);
      const rows = saved.changes.sort((a, b) => a.rev - b.rev);
      const opened = this.opener(rows, false, stop);
      for (const [index, row] of rows.entries()) {
        if (stop.aborted || epoch !== this.epoch) return;
        await this.apply(row, () => opened(index), false, stop);
      }
      this.changed();
      this.restored = true;
    } catch (error) {
      // Cancellation and a failed worker say nothing about the validity of the encrypted device copy.
      if (error instanceof CodecAborted) return;
      if (error instanceof CodecUnavailable) {
        this.openingFailure = this.codecFailure(error, epoch);
        return;
      }
      this.cacheFailed = true;
      this.reset(false);
    }
  }

  get cached(): boolean { return this.restored; }

  private cacheState(scope?: Scope): CacheState {
    return {
      cursor: scope?.cursor ?? this.cursor,
      complete: scope ? scope.state === 'loaded' : this.bootstrapped,
      until: scope ? null : this.bootstrap,
      limits: this.limits,
      heads: scope ? [] : [...this.heads],
      revisions: scope ? [] : [...this.revisions],
    };
  }

  private cacheWrite(changes: SealedChange[], chat?: string, scope?: Scope, complete = false) {
    if (!this.cache || this.cacheFailed || this.timeline === null) return;
    const scopes = chat && scope ? [{ chat, state: { ...this.cacheState(scope), complete } }] : [...new Set(changes.filter((row) => SCOPED.has(row.kind)).map((row) => row.parent!))].flatMap((chat) => {
      const held = this.scopes.get(chat);
      return held?.state === 'loaded' && !held.loading ? [{ chat, state: this.cacheState(held) }] : [];
    });
    const write: CacheWrite = { changes, feed: this.cacheState(), scopes };
    this.queueCache((generation) => this.cache!.write(generation, write));
  }

  // A failed transaction leaves a valid prefix. Never advance a later cursor past rows it failed to save. Work queued in
  // an epoch that has ended is skipped, since what it holds is of a timeline this tab dropped. A changed generation is
  // not a failure: another tab moved the cache, and this one reloads from it.
  private queueCache(work: (generation: Generation) => Promise<void>) {
    const epoch = this.epoch;
    this.caching = this.caching.then(async () => {
      if (!this.cacheFailed && epoch === this.epoch) await work(this.generation!);
    }).catch((error: unknown) => {
      if (!(error instanceof GenerationChanged)) this.cacheFailed = true;
      else if (epoch === this.epoch) this.reopen();
    });
  }

  // Told once for each switch of timeline this tab hears, with how many of the person's writes it dropped.
  readonly subscribeRewound = (listener: (dropped: number) => void) => {
    this.rewoundListeners.add(listener);
    return () => { this.rewoundListeners.delete(listener); };
  };

  // The server refused the timeline this tab holds: what it holds goes, from memory and from the cache, and a pull
  // bootstraps the new timeline (the pull under way, when a pull heard it).
  private rewind() {
    this.reset(true);
    if (this.cache) this.queueCache(async (generation) => { this.generation = await this.cache!.clear(generation); });
    this.catchUp();
  }

  // A pull under way bootstraps on its next page; one already past its pages does not, so another follows it.
  private catchUp() {
    void (this.pulling ?? Promise.resolve()).then(() => {
      if (!this.closing.signal.aborted && !this.bootstrapped) void this.pull();
    });
  }

  // Another tab moved the cache to a generation of its own.
  private reopen() {
    this.reset(true);
    const epoch = this.epoch;
    const opening: Promise<void> = this.caching.then(() => this.load(epoch)).finally(() => {
      if (this.opening === opening) this.opening = null;
    });
    this.opening = this.caching = opening;
    void opening.then(() => this.catchUp());
  }

  private adopt(timeline: string) {
    this.timeline = timeline;
    if (this.cache) this.queueCache(async (generation) => { this.generation = await this.cache!.adopt(generation, timeline); });
  }

  // Old-timeline writes are dropped, never replayed: every commit under way ends with the epoch, its unsent writes
  // counted. heard: the server or another tab said the account moved to another timeline, which the person is told.
  private reset(heard: boolean) {
    const dropped = this.unsentWrites();
    this.unsent.clear();
    const held = this.timeline !== null;
    this.timeline = null;
    this.epoch++;
    this.ended.abort();
    this.ended = new AbortController();
    for (const object of [...this.live.values(), ...this.overlays.values()]) this.changes.push({ kind: object.kind, id: object.id, parent: object.parent });
    this.overlays.clear();
    this.marks.clear();
    for (const [chat, scope] of this.scopes) {
      scope.abort.abort();
      scope.abort = new AbortController();
      scope.state = 'unloaded';
      scope.cursor = scope.head = 0;
      scope.fold = this.chatFold(chat);
      scope.loading = scope.opening = null;
      this.behind.add(chat);
    }
    this.live.clear();
    this.deleted.clear();
    this.byKind.clear();
    this.byParent.clear();
    this.heads.clear();
    this.revisions.clear();
    this.projections.reset();
    this.unreadableCount = this.cursor = this.known = 0;
    this.bootstrap = null;
    this.bootstrapped = this.restored = false;
    this.limits = null;
    this.changed();
    if (heard && (held || dropped)) for (const listener of this.rewoundListeners) listener(dropped);
  }

  private cacheBounds(known = this.known) {
    return this.cache ? `&known=${known}` : '';
  }

  readonly subscribe = (listener: (changes: readonly StoreChange[]) => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly waiting = () => this.waitingCalls > 0;

  // Writes shown or waiting their turn that the server has not taken yet: a page closed now loses them.
  readonly unsentWrites = () => {
    let count = 0;
    for (const unsent of this.unsent) count += unsent();
    return count;
  };

  readonly subscribeWaiting = this.waitChanges.subscribe;

  // Capture is synchronous: every missing read counts too, so a later create invalidates it.
  capture<T>(read: () => T): { value: T; reads: StoreRead[] } {
    const previous = this.reading;
    const reads: StoreRead[] = [];
    this.reading = reads;
    try {
      return { value: read(), reads };
    } finally {
      this.reading = previous;
      previous?.push(...reads);
    }
  }

  // The evaluation reads a chat's verdict as it posts a job, which may be inside the capture of what asked for it: that
  // is the job's own bookkeeping, not what its caller displays from.
  private unrecorded<T>(read: () => T): T {
    const previous = this.reading;
    this.reading = null;
    try {
      return read();
    } finally {
      this.reading = previous;
    }
  }

  get<K extends Kind>(kind: K, id: string): Stored<K> | null {
    this.reading?.push({ kind, id });
    const held = this.shown(id);
    const parent = (this.overlays.get(id) ?? this.live.get(id))?.parent;
    if (SCOPED.has(kind) && (!parent || this.scopeState(parent) !== 'loaded')) throw new ScopeUnavailable(parent ?? null);
    return held && held.kind === kind && held.value !== undefined ? (held as Stored<K>) : null;
  }

  list<K extends Kind>(kind: K): Stored<K>[] {
    if (SCOPED.has(kind)) throw new ScopeUnavailable(null);
    this.reading?.push({ kind, list: true });
    return this.shownOf(this.byKind.get(kind), (held) => held.kind === kind);
  }

  children<K extends Kind>(kind: K, parent: string): Stored<K>[] {
    if (SCOPED.has(kind) && this.scopeState(parent) !== 'loaded') throw new ScopeUnavailable(parent);
    this.reading?.push({ kind, parent });
    return this.shownOf(this.byParent.get(parent)?.get(kind), (held) => held.kind === kind && held.parent === parent);
  }

  private shown(id: string): Held | undefined {
    const overlay = this.overlays.get(id);
    return overlay ? overlay.held ?? undefined : this.live.get(id);
  }

  private shownOf<K extends Kind>(ids: Set<string> | undefined, matches: (held: Held) => boolean): Stored<K>[] {
    const shown: Held[] = [];
    for (const id of ids ?? []) {
      const held = this.shown(id);
      if (held && matches(held)) shown.push(held);
    }
    for (const { id, held } of this.overlays.values()) if (held && !ids?.has(id) && matches(held)) shown.push(held);
    return shown.filter((held): held is Stored<K> => held.value !== undefined);
  }

  shownMark(chat: string): number {
    return this.marks.get(chat) ?? 0;
  }

  private showing(chat: string): boolean {
    for (const overlay of this.overlays.values()) if (chatOf(overlay) === chat) return true;
    return false;
  }

  private show({ id, kind, parent, value }: Pending, mine: Map<string, Overlay>) {
    // As hold keeps them: a chat's entries and memory only while the chat is held.
    if (SCOPED.has(kind) && !(parent && this.scopes.has(parent))) return;
    const held = value === undefined ? null : { id, kind, parent, value, rev: this.live.get(id)?.rev ?? 0, pending: ++this.shownCount };
    const overlay = { id, kind, parent, held };
    this.overlays.set(id, overlay);
    mine.set(id, overlay);
    this.marked(overlay);
  }

  // Only the commit's own overlay goes: a later write's stays until its own answer.
  private unshow(id: string, mine: Map<string, Overlay>) {
    const overlay = mine.get(id);
    mine.delete(id);
    if (!overlay || this.overlays.get(id) !== overlay) return;
    this.overlays.delete(id);
    this.marked(overlay);
  }

  private marked(overlay: Overlay) {
    const { id, kind, parent } = overlay;
    if (!SCOPED.has(kind) || (parent && this.scopeState(parent) === 'loaded')) this.changes.push({ kind, id, parent });
    const chat = chatOf(overlay);
    if (!chat) return;
    const mark = ++this.shownCount;
    this.marks.set(chat, mark);
    if (kind === 'entry') this.scopes.get(chat)?.fold.changed(id);
  }

  close() {
    this.closing.abort();
    this.codec.close();
    this.evaluation.close();
    for (const scope of this.scopes.values()) scope.abort.abort();
    this.listeners.clear();
    this.rewoundListeners.clear();
    this.live.clear();
    this.overlays.clear();
    this.byKind.clear();
    this.byParent.clear();
    this.projections.close();
    this.scopes.clear();
    this.heads.clear();
    this.revisions.clear();
    this.deleted.clear();
    this.unreadableCount = 0;
  }

  scopeState(chat: string): ScopeState {
    return this.scopes.get(chat)?.state ?? 'unloaded';
  }

  scopeError(chat: string): ApiFailure | null {
    return this.scopes.get(chat)?.error ?? null;
  }

  entryHead(chat: string): number {
    return this.heads.get(chat) ?? 0;
  }

  loadedHead(chat: string): number {
    return this.scopes.get(chat)?.head ?? 0;
  }

  revision(read: StoreRead): number {
    if ('id' in read) return this.live.get(read.id)?.rev ?? this.deleted.get(read.id) ?? 0;
    return this.revisions.get(JSON.stringify('list' in read ? { kind: read.kind, list: true } : { kind: read.kind, parent: read.parent })) ?? 0;
  }

  private chatFold(chat: string) {
    return new ChatFold((id) => {
      const held = this.shown(id);
      return held?.kind === 'entry' && held.parent === chat && held.value !== undefined ? held as Stored<'entry'> : null;
    });
  }

  foldedChat(chat: string) {
    if (this.scopeState(chat) !== 'loaded') throw new ScopeUnavailable(chat);
    return this.scopes.get(chat)!.fold.snapshot();
  }

  // A held chat that could not be opened or evaluated: its screen says so and offers 다시 시도 (useChatModel).
  private failScope(chat: string, scope: Scope, epoch: number, error: unknown): ApiFailure {
    const failure = this.codecFailure(error, epoch);
    if (this.scopes.get(chat) === scope && epoch === this.epoch && !this.closing.signal.aborted) {
      scope.state = 'failed';
      scope.error = failure;
      this.scopeChanged(chat);
    }
    return failure;
  }

  // created: the caller is writing this chat's first objects under a new id, so the server has nothing to pull for it.
  // summarize: opening writes the chat's summary when it has outgrown it (the list shows that chat fresh); a pass that
  // writes a window's summaries in one request (withChats for saveSummaries) opens without.
  retainChat(chat: string, { created = false, summarize = true }: { created?: boolean; summarize?: boolean } = {}): ChatLease {
    if (this.closing.signal.aborted) return { ready: Promise.resolve({ ok: false, error: 'stopped' }), release: () => {} };
    let scope = this.scopes.get(chat);
    if (!scope) {
      scope = { fold: this.chatFold(chat), opening: null, abort: new AbortController(), state: created ? 'loaded' : 'unloaded', users: 0, cursor: 0, head: 0, loading: null, error: null, summarize };
      this.scopes.set(chat, scope);
      if (created) this.cacheWrite([], chat, scope, true);
    }
    scope.users++;
    const held = scope;
    // A chat opened for a pass that then writes no summary (stopped, or another of its window failed to open) still
    // gets one when a later holder asked for it: that holder's screen shows the chat in the list.
    if (summarize && !held.summarize) {
      held.summarize = true;
      void (held.opening ?? Promise.resolve(null)).then((failure) => { if (!failure && this.scopes.get(chat) === held) this.projections.summarizeChat(chat); });
    }
    if (held.state !== 'loaded' && !held.opening) {
      const epoch = this.epoch;
      const opening = this.openChat(chat, held, summarize).catch((error: unknown) => this.failScope(chat, held, epoch, error)).finally(() => { if (held.opening === opening) held.opening = null; });
      held.opening = opening;
    }
    const epoch = this.epoch;
    const ready = held.opening ?? (held.loading ? Promise.resolve(null) : this.projections.evaluate(chat).then(() => null, (error: unknown) => this.codecFailure(error, epoch)));
    let released = false;
    return { ready, release: () => {
      if (released) return;
      released = true;
      held.users--;
      if (!held.users) this.releaseChat(chat, held);
    } };
  }

  private async openChat(chat: string, scope: Scope, summarize: boolean): Promise<ApiFailure | null> {
    const epoch = this.epoch;
    const signal = AbortSignal.any([scope.abort.signal, this.closing.signal, this.ended.signal]);
    scope.state = 'loading';
    this.scopeChanged(chat);
    await this.caching;
    const saved = await this.cachedChat(chat);
    if (signal.aborted || this.scopes.get(chat) !== scope) return this.halted(epoch);
    if (saved) {
      scope.cursor = saved.state.cursor;
      const rows = saved.changes.sort((a, b) => a.rev - b.rev);
      const opened = this.opener(rows, true, signal);
      for (const [index, row] of rows.entries()) {
        await this.apply(row, () => opened(index), true, signal);
        if (signal.aborted) return this.halted(epoch);
        if (row.body && this.live.get(row.id)?.value === undefined) {
          scope.state = 'failed';
          scope.error = { ok: false, error: 'unreadable' };
          this.scopeChanged(chat);
          return scope.error;
        }
      }
      if (signal.aborted) return this.halted(epoch);
      if (saved.state.complete && !saved.changes.some((row) => row.omitted)) {
        scope.state = 'loaded';
        await this.projections.evaluate(chat);
        this.scopeChanged(chat);
        // Ready is cache-only; catch-up and summary writes must not hold the chat screen behind the network.
        void this.refreshChat(chat).then((failure) => { if (!failure && scope.users && summarize) this.projections.summarizeChat(chat); });
        return null;
      }
    }
    const failure = await this.refreshChat(chat);
    return failure ?? (summarize ? await this.projections.save(chat) : null);
  }

  // What an operation begun in epoch answers when it is cut short: timeline-changed once a reset has ended that epoch,
  // stopped for the store closing, the caller's own stop and a released lease.
  private halted(epoch: number): ApiFailure {
    return epoch !== this.epoch && !this.closing.signal.aborted ? changed() : { ok: false, error: 'stopped' };
  }

  private codecFailure(error: unknown, epoch: number): ApiFailure {
    if (error instanceof EvaluationStopped || error instanceof CodecAborted) return this.halted(epoch);
    if (error instanceof EvaluationStuck) return { ok: false, error: 'bot-stuck' };
    if (error instanceof EvaluationFailed) return { ok: false, error: 'evaluation-unavailable' };
    if (error instanceof CodecUnavailable) return { ok: false, error: 'codec-unavailable' };
    throw error;
  }

  // A chat's cached rows, only while the stored generation is the one this tab holds: rows another tab cached of
  // another timeline are never applied here.
  private async cachedChat(chat: string): Promise<CachedScope | null> {
    const generation = this.generation;
    if (!this.cache || this.cacheFailed || generation?.timeline == null) return null;
    const epoch = this.epoch;
    return this.cache.read(generation, chat).catch((error: unknown) => {
      if (error instanceof GenerationChanged && epoch === this.epoch) this.reopen();
      return null;
    });
  }

  // signal: the caller's stop, which lets the chat go at once, ending its opening and a summary write waiting on the
  // connection; what run does with the chat after that ends as stopped (ChatProjections.save).
  withChat<T>(chat: string, run: () => Promise<ApiResult<T>>, signal?: AbortSignal): Promise<ApiResult<T>> {
    return this.withChats([chat], (_, [passed]) => (passed ? Promise.resolve(passed) : run()), { signal });
  }

  // Several chats held together and opened at once, for run. One whose history cannot be read, or whose bot does not end
  // even without its regex, is left out of what run gets (passed, its failure), since its screen says so and a pass over
  // many (saveSummaries) passes it over; any other failure to open ends the whole. signal: as withChat, for every chat.
  // summarize: as retainChat.
  async withChats<T>(chats: string[], run: (readable: string[], passed: ApiFailure[]) => Promise<ApiResult<T>>, { signal, summarize = true }: { signal?: AbortSignal; summarize?: boolean } = {}): Promise<ApiResult<T>> {
    if (signal?.aborted) return { ok: false, error: 'stopped' };
    const leases = chats.map((chat) => this.retainChat(chat, { summarize }));
    const release = () => { for (const lease of leases) lease.release(); };
    signal?.addEventListener('abort', release, { once: true });
    try {
      const readable: string[] = [];
      const passed: ApiFailure[] = [];
      for (const [index, lease] of leases.entries()) {
        const failure = await lease.ready;
        if (signal?.aborted) return { ok: false, error: 'stopped' };
        if (!failure) readable.push(chats[index]!);
        else if (failure.error === 'unreadable' || failure.error === 'bot-stuck') passed.push(failure);
        else return failure;
      }
      return await run(readable, passed);
    } finally { signal?.removeEventListener('abort', release); release(); }
  }

  refreshChat(chat: string): Promise<ApiFailure | null> {
    const scope = this.scopes.get(chat);
    if (!scope) throw new ScopeUnavailable(chat);
    if (scope.loading) return scope.loading;
    if (scope.state !== 'loaded') scope.state = 'loading';
    scope.error = null;
    const abort = scope.abort;
    const epoch = this.epoch;
    scope.loading = this.pullParent(chat, scope, abort.signal).catch((error: unknown) => this.codecFailure(error, epoch)).then(async (failure) => {
      if (abort.signal.aborted || this.scopes.get(chat) !== scope) return this.halted(epoch);
      scope.error = failure;
      scope.state = failure && (scope.state !== 'loaded' || failure.error === 'unreadable') ? 'failed' : 'loaded';
      scope.loading = null;
      if (!failure) {
        try { await this.projections.evaluate(chat); }
        catch (error) { failure = this.codecFailure(error, epoch); }
      }
      this.scopeChanged(chat);
      return failure;
    });
    this.scopeChanged(chat);
    return scope.loading;
  }

  private releaseChat(chat: string, scope: Scope) {
    scope.abort.abort();
    scope.loading = null;
    for (const kind of SCOPED) {
      for (const id of [...(this.byParent.get(chat)?.get(kind) ?? [])]) this.forget(id);
    }
    this.projections.release(chat);
    for (const asker of ['headless', 'send', 'forecast', 'memory', 'view'] as const) this.evaluation.forget({ asker, chat });
    scope.state = 'unloaded';
    scope.cursor = 0;
    scope.head = 0;
    scope.error = null;
    if (this.scopes.get(chat) === scope) this.scopes.delete(chat);
    this.scopeChanged(chat);
  }

  // An explicit account/parent walk; it never fills the held chat scopes. Backup and ownership walks run on their
  // workflow's pin (pinned); usage reads on a bare pin, since it writes nothing. No row is visited once the pin's epoch
  // has ended.
  async scan(options: { parent?: string; kind?: Kind; metadata?: boolean }, visit: (row: ObjectRow, value: unknown) => void | Promise<void>, pin: Pin, signal?: AbortSignal): Promise<ApiFailure | null> {
    const stop = AbortSignal.any([this.closing.signal, this.ended.signal, ...(signal ? [signal] : [])]);
    let cursor = 0;
    let more = true;
    while (more) {
      if (pin.epoch !== this.epoch || stop.aborted) return this.halted(pin.epoch);
      const result = await this.request<Page>('GET', `objects?since=${cursor}${options.parent ? `&parent=${encodeURIComponent(options.parent)}` : ''}${options.kind ? `&kind=${options.kind}` : ''}${options.metadata ? '&metadata=1' : ''}&timeline=${encodeURIComponent(pin.timeline)}`, undefined, stop);
      // An answer to a request sent before a reset is of the old timeline, a refusal too: it never resets the new one.
      if (pin.epoch !== this.epoch) return changed();
      if (!result.ok) {
        if (result.error !== 'cache-reset') return result;
        this.rewind();
        return changed();
      }
      this.limits = result.data.limits;
      const opened = this.opener(result.data.changes, true, stop, true);
      for (const [index, { body, omitted, ...row }] of result.data.changes.entries()) {
        if (stop.aborted) return this.halted(pin.epoch);
        if (body === null) continue;
        let value: unknown;
        try {
          value = omitted ? undefined : await opened(index);
        } catch (error) {
          return this.codecFailure(error, pin.epoch);
        }
        value = upgradeValue(row.kind, value) ?? value;
        if (stop.aborted) return this.halted(pin.epoch);
        // Awaited, so a slow visitor holds the walk; no next codec window starts ahead of its demand.
        await visit(row, value);
      }
      cursor = result.data.cursor;
      more = result.data.more;
    }
    return null;
  }

  async removeRows(rows: ObjectRow[]): Promise<ApiResult<null>> {
    const removed = await this.commit(rows.map((row) => ({ id: row.id, resolve: (at) => {
      const held = at(row.id);
      if (!held && (this.deleted.get(row.id) ?? 0) >= row.rev) return { ok: true, data: { pending: null, held: null } };
      return { ok: true, data: { pending: { ...row, value: undefined, baseRev: held?.rev ?? row.rev }, held: null } };
    } })));
    return removed.ok ? { ok: true, data: null } : removed;
  }

  // The objects held in a shape upgraded as they were read (runtime/upgrade), each handed out once.
  takeUpgraded(): { id: string; kind: string }[] {
    const taken = [...this.upgraded].map(([id, kind]) => ({ id, kind }));
    this.upgraded.clear();
    return taken;
  }

  unreadable(): number {
    return this.unreadableCount;
  }

  // A store holding no timeline pulls one first, as one about to write does.
  async pin(signal?: AbortSignal): Promise<ApiResult<Pin>> {
    const epoch = this.epoch;
    if (!this.limits || this.timeline === null) {
      const failure = await this.reaching(() => this.pull(), signal ? AbortSignal.any([this.closing.signal, signal]) : this.closing.signal);
      if (failure) return epoch === this.epoch ? failure : this.halted(epoch);
    }
    return epoch === this.epoch ? { ok: true, data: { timeline: this.timeline!, epoch } } : this.halted(epoch);
  }

  // A workflow of several requests on one timeline: a backup's two scans, its restore, the Risu move, a removal, a chat
  // turn (runtime/talk). run's scans take the pin, and every write made while it runs fails with timeline-changed once
  // the pin's epoch has ended, so no part of a workflow begun on one timeline lands on the next. A write of the new
  // epoch fails too until the workflow has ended.
  async pinned<T>(run: (pin: Pin) => Promise<T>, signal?: AbortSignal): Promise<T | ApiFailure> {
    const pin = await this.pin(signal);
    if (!pin.ok) return pin;
    this.workflows.add(pin.data);
    try {
      return await run(pin.data);
    } finally {
      this.workflows.delete(pin.data);
    }
  }

  // One pull at a time: a caller arriving during a pull waits for that pull instead of starting another.
  // The caller starting it owns its signal and progress.
  pull(options: PullOptions = {}): Promise<ApiFailure | null> {
    if (this.openingFailure) return Promise.resolve(this.openingFailure);
    if (!this.pulling) {
      const epoch = this.epoch;
      // The opening pull runs before the shell holds the store, so waiting for the connection rides on its progress.
      const { progress } = options;
      let last: PullProgress = { objects: 0, pages: 0, waiting: false };
      const report = progress && ((next: PullProgress) => progress((last = next)));
      const unwatch = report ? this.subscribeWaiting(() => report({ ...last, waiting: this.waiting() })) : () => {};
      this.pulling = this.pullPages({ ...options, progress: report }).catch((error: unknown) => this.codecFailure(error, epoch)).finally(() => {
        unwatch();
        this.pulling = null;
      });
    }
    return this.pulling;
  }

  // One user action's writes, owned objects before their owners and in the order given within a kind, so an owner
  // appears only once whole and a chat's entries keep their rev order, which model/chat fold reads. An action
  // larger than one request goes as several, the owner in the last; one cut short leaves only unreachable pieces.
  // unheld: the writes' chats are not held for them and nothing is summarized after them: a restore's entries before
  // their chats, whose next lease pulls what was written, or a move's, held by the move and summarized together once
  // their character is published (ChatProjections.saveMany). signal: the caller's stop, which also ends a wait for the
  // connection to return.
  async batch(writes: Write[], progress: (write: Write) => void = () => {}, { unheld = false, signal }: { unheld?: boolean; signal?: AbortSignal } = {}): Promise<ApiResult<null>> {
    const puts = orderOwned(writes.filter((write) => write.type !== 'remove'));
    const ordered = [...puts, ...writes.filter((write) => write.type === 'remove')];
    const chats = new Set<string>();
    const created = new Set<string>();
    for (const write of unheld ? [] : ordered) {
      if (write.type === 'remove') {
        const held = this.live.get(write.id);
        if (held && SCOPED.has(held.kind) && held.parent) chats.add(held.parent);
      } else if (write.kind === 'chat') {
        chats.add(write.id);
        if (write.type === 'create') created.add(write.id);
      } else if (SCOPED.has(write.kind) && write.parent) chats.add(write.parent);
    }
    // Every touched chat stays held until its summary is written; entries held without a scope would never be let go.
    const leases = [...chats].map((chat) => this.retainChat(chat, { created: created.has(chat) }));
    try {
      for (const lease of leases) {
        const failure = await lease.ready;
        if (failure) return failure;
      }
      const result = await this.commit(ordered.map((write) => this.step(write)), (index) => progress(ordered[index]!), signal);
      if (!result.ok) return result;
      if (!unheld) this.projections.summarizeHeld();
      return { ok: true, data: null };
    } finally {
      for (const lease of leases) lease.release();
    }
  }

  // A create whose answer was lost after it landed finds its own object there when tried again, and
  // succeeds: a retried write with the same id is idempotent.
  create<K extends Exclude<Kind, Singleton>>(kind: K, value: Values[K], { id = crypto.randomUUID(), parent = null }: { id?: string; parent?: string | null } = {}): Promise<ApiResult<Stored<K>>> {
    return this.writeOne<K>(this.step({ type: 'create', kind, id, parent, value }), SCOPED.has(kind) ? parent : null);
  }

  // The parent is the live object's, so an update never moves an object. One that is gone, or goes
  // while a conflict is resolved, fails as 'gone' and is never written back. So does a change that answers null: what
  // it changes is no longer there in the copy it is applied to, and nothing is written.
  update<K extends Exclude<Kind, AppendOnly>>(kind: K, id: string, change: (current: Values[K]) => Values[K] | null): Promise<ApiResult<Stored<K>>> {
    return this.writeOne<K>({
      id,
      resolve: (at) => {
        const held = at(id);
        if (!held || held.kind !== kind) return { ok: false, error: SCOPED.has(kind) ? 'not-loaded' : 'gone' };
        if (held.value === undefined) return { ok: false, error: 'unreadable' };
        const value = change(held.value as Values[K]);
        if (value === null) return { ok: false, error: 'gone' };
        return { ok: true, data: { pending: { kind, id, parent: held.parent, value, baseRev: held.rev }, held: null } };
      },
    }, SCOPED.has(kind) ? this.live.get(id)?.parent ?? null : null);
  }

  // A singleton lives at the id its kind names, and current is undefined until it is first written.
  upsert<K extends Singleton>(kind: K, change: (current: Values[K] | undefined) => Values[K]): Promise<ApiResult<Stored<K>>> {
    const id = KINDS[kind].id;
    return this.writeOne<K>({
      id,
      resolve: (at) => {
        const held = at(id);
        if (held && held.value === undefined) return { ok: false, error: 'unreadable' };
        return { ok: true, data: { pending: { kind, id, parent: null, value: change(held?.value as Values[K] | undefined), baseRev: held?.rev ?? null }, held: null } };
      },
    }, null);
  }

  // Writes a snapshot back (되돌리기, and a backup's objects): over the live object, or in place of a deleted
  // one at the rev its deletion took, under the parent it had.
  restore<K extends Kind>({ id, kind, parent, value }: Stored<K>): Promise<ApiResult<Stored<K>>> {
    return this.writeOne<K>(this.step({ type: 'restore', id, kind, parent, value }), SCOPED.has(kind) ? parent : null);
  }

  async remove(id: string): Promise<ApiResult<null>> {
    return this.batch([{ type: 'remove', id }]);
  }

  async take<K extends Kind>(kind: K, id: string): Promise<ApiResult<Stored<K>>> {
    const object = this.get(kind, id);
    if (!object) return { ok: false, error: 'gone' };
    const removed = await this.remove(id);
    return removed.ok ? { ok: true, data: object } : removed;
  }

  // chat: a scoped write's chat, held for the base revision of what the write changes.
  private async writeOne<K extends Kind>(step: Step, chat: string | null): Promise<ApiResult<Stored<K>>> {
    const lease = chat ? this.retainChat(chat) : null;
    try {
      // Never await without a lease: commit shows the write, and a create must be readable as its call returns.
      if (lease) {
        const failure = await lease.ready;
        if (failure) return failure;
      }
      const result = await this.one<K>(step);
      if (result.ok) this.projections.summarizeHeld();
      return result;
    } finally {
      lease?.release();
    }
  }

  private async one<K extends Kind>(step: Step): Promise<ApiResult<Stored<K>>> {
    const result = await this.commit([step]);
    return result.ok ? { ok: true, data: result.data[0] as Stored<K> } : result;
  }

  private step(write: Write): Step {
    return {
      id: write.id,
      derived: write.type !== 'remove' && write.kind === 'summary',
      resolve: (at) => {
        const held = at(write.id);
        if (write.type === 'remove') {
          if (!held && !this.deleted.has(write.id)) return { ok: false, error: 'not-loaded' };
          return { ok: true, data: { pending: held ? { ...held, value: undefined, baseRev: held.rev } : null, held: null } };
        }
        const { id, kind, parent, value } = write;
        if (!this.fits(kind, parent)) return { ok: false, error: 'bad-input' };
        if (write.type === 'create' && held) {
          const landed = held.kind === kind && held.parent === parent && JSON.stringify(held.value) === JSON.stringify(value);
          return landed ? { ok: true, data: { pending: null, held } } : { ok: false, error: 'conflict' };
        }
        if (held && held.value === undefined) return { ok: false, error: 'unreadable' };
        const baseRev = write.type === 'create' ? null : held?.rev ?? this.deleted.get(id) ?? null;
        return { ok: true, data: { pending: { id, kind, parent, value, baseRev }, held: null } };
      },
    };
  }

  private async retry<T>(attempt: () => Promise<ApiResult<T>>, stop: AbortSignal): Promise<ApiResult<T>> {
    for (let tries = 0; tries < MAX_ATTEMPTS; tries++) {
      const result = await this.reaching(attempt, stop);
      if (result.ok || result.error !== 'conflict') return result;
      const failure = await this.reaching(() => this.pull(), stop);
      if (failure) return failure;
    }
    return { ok: false, error: 'conflict' };
  }

  // A call that cannot reach the server waits and tries again until it does, or until stop (the store closing, the
  // caller's stop, or a reset) ends it: a dropped connection, a restore under way or a store not answering yet does not
  // fail it. Reads wait too: a store evicted after an idle hour wakes slower than one page's wait, and a reload landing
  // in a chat must outlast that, not toast it. A write whose answer was lost after it landed comes back as a conflict
  // and is applied again, so an update's change must read the same applied twice as once (set a value, never add to
  // one). A file's upload (runtime/files) waits the same way, and shows as the same waiting.
  async reaching<R extends ApiResult<unknown> | null>(attempt: () => Promise<R>, stop: AbortSignal = this.closing.signal): Promise<R | ApiFailure> {
    let result: R | ApiFailure = await attempt();
    if (!waits(result)) return result;
    this.wait(1);
    try {
      for (let tries = 0; waits(result); tries++) {
        const after = result.retryAfter === undefined ? RECONNECT_PAUSES[Math.min(tries, RECONNECT_PAUSES.length - 1)]! : result.retryAfter * 1000;
        if (!(await pause(after, stop))) return { ok: false, error: 'stopped' };
        result = await attempt();
      }
      return result;
    } finally {
      this.wait(-1);
    }
  }

  private wait(by: 1 | -1) {
    this.waitingCalls += by;
    this.waitChanges.notify();
  }

  private async commit(steps: Step[], progress: (index: number) => void = () => {}, signal?: AbortSignal): Promise<ApiResult<(Held | null)[]>> {
    const stop = signal ? AbortSignal.any([this.closing.signal, signal]) : this.closing.signal;
    if (stop.aborted) return { ok: false, error: 'stopped' };
    const epoch = this.epoch;
    const saved: (Held | null)[] = [];
    const unsent = () => steps.slice(saved.length).filter((step) => !step.derived).length;
    this.unsent.add(unsent);
    const ids = [...new Set(steps.map((step) => step.id))];
    const earlier = ids.flatMap((id) => this.claims.get(id) ?? []);
    let release = () => {};
    const claim = new Promise<void>((resolve) => { release = resolve; });
    for (const id of ids) this.claims.set(id, claim);
    const shown = new Map<string, Overlay>();
    try {
      // Shown before the wait for an earlier write to the same object, applied to what reads show: the real resolve,
      // against live, runs inside send.
      for (const step of steps) {
        if (step.derived) continue;
        let preview: ApiResult<Resolved>;
        try { preview = step.resolve((id) => this.shown(id)); } catch { continue; }
        if (preview.ok && preview.data.pending) this.show(preview.data.pending, shown);
      }
      if (shown.size) {
        this.changed();
        this.projections.refreshHeld();
      }
      if (earlier.length) {
        if (!(await waited(Promise.all(earlier), stop))) return { ok: false, error: 'stopped' };
        if (epoch !== this.epoch) return this.halted(epoch);
      }
      return await this.send(steps, saved, progress, stop, shown);
    } catch (error) {
      return this.codecFailure(error, epoch);
    } finally {
      this.unsent.delete(unsent);
      release();
      for (const id of ids) if (this.claims.get(id) === claim) this.claims.delete(id);
      // A write that failed for good shows the confirmed copy again; its caller still gets the failure.
      if (shown.size) {
        for (const id of [...shown.keys()]) this.unshow(id, shown);
        this.changed();
        this.projections.refreshHeld();
      }
    }
  }

  private async send(steps: Step[], saved: (Held | null)[], progress: (index: number) => void, stop: AbortSignal, shown: Map<string, Overlay>): Promise<ApiResult<(Held | null)[]>> {
    const confirmed = (id: string) => this.live.get(id);
    const pinned = await this.pin(stop);
    if (!pinned.ok) return pinned;
    const { timeline, epoch } = pinned.data;
    if ([...this.workflows].some((workflow) => workflow.epoch !== epoch)) return changed();
    const limits = this.limits!;
    const halt = AbortSignal.any([stop, this.ended.signal]);
    while (saved.length < steps.length) {
      const start = saved.length;
      // Requests are counted from the back, so the last one is full: an owner, written last, goes with the owned objects
      // just before it (runtime/characters addCharacter puts a move's chat roots there).
      const end = start + ((steps.length - start - 1) % limits.items) + 1;
      const result = await this.retry(async (): Promise<ApiResult<(Held | null)[]>> => {
        const resolved: Resolved[] = [];
        const writes: { id: string; kind: string; parent: string | null; baseRev: number | null; body: string | null }[] = [];
        let bytes = encoder.encode(JSON.stringify({ timeline, writes: [] })).length;
        // Resolve and seal afresh INSIDE every retry. Keep only a small value window, not the server's entire
        // item page. Future failures stay in their slots until the byte-limited prefix reaches them.
        filling: for (let from = start; from < end; from += SEAL_ITEMS) {
          if (halt.aborted) return this.halted(epoch);
          const window = steps.slice(from, Math.min(from + SEAL_ITEMS, end)).map((step) => {
            try { return { ready: step.resolve(confirmed) }; }
            catch (error) { return { error }; }
          });
          const items: SealItem[] = [];
          const slots = new Map<number, number>();
          for (const [index, entry] of window.entries()) {
            const pending = entry.ready?.ok ? entry.ready.data.pending : null;
            if (!pending || pending.value === undefined) continue;
            slots.set(index, items.length);
            items.push(pending);
          }
          const sealed = items.length ? await this.codec.seal(items, limits.body, halt) : [];
          for (const [index, entry] of window.entries()) {
            if (!entry.ready) throw entry.error;
            const ready = entry.ready;
            if (!ready.ok) return ready;
            const { pending } = ready.data;
            if (pending) {
              const { id, kind, parent, baseRev, value } = pending;
              const body = value === undefined ? null : codecValue(sealed[slots.get(index)!]!);
              if (value !== undefined && body === null) return { ok: false, error: 'too-large' };
              const write = { id, kind, parent, baseRev, body };
              const size = encoder.encode(JSON.stringify(write)).length + (writes.length ? 1 : 0);
              if (bytes + size > limits.bytes) {
                if (!resolved.length) return { ok: false, error: 'too-large' };
                break filling;
              }
              bytes += size;
              writes.push(write);
            }
            resolved.push(ready.data);
          }
        }
        if (writes.length) {
          if (epoch !== this.epoch) return changed();
          if (stop.aborted) return { ok: false, error: 'stopped' };
          const answer = await this.request<{ revs: number[] }>('POST', 'objects/batch', { timeline, writes }, halt);
          // Only the store closing or a reset drops an answer: a caller's stop that arrives after the write landed keeps
          // it held. An answer to a request sent before a reset is of the old timeline, a refusal too, so this is checked
          // before the refusal is read: an old 409 or 503 never resets the new timeline.
          if (this.closing.signal.aborted) return { ok: false, error: 'stopped' };
          if (epoch !== this.epoch) return changed();
          if (!answer.ok) {
            if (answer.error !== 'cache-reset') return answer;
            this.rewind();
            return changed();
          }
          let index = 0;
          for (const ready of resolved) {
            if (!ready.pending) continue;
            const { id, kind, parent, value } = ready.pending;
            const rev = answer.data.revs[index++]!;
            if (value === undefined) this.drop(id, rev, { kind, id, parent });
            else {
              ready.held = { id, kind, parent, value, rev };
              this.hold(ready.held);
            }
          }
          this.cacheWrite(writes.map(({ id, kind, parent, body }, index) => ({ id, kind, parent, body, rev: answer.data.revs[index]! })));
        }
        for (let index = 0; index < resolved.length; index++) this.unshow(steps[start + index]!.id, shown);
        this.changed();
        return { ok: true, data: resolved.map(({ held }) => held) };
      }, halt);
      if (!result.ok) return epoch === this.epoch ? result : this.halted(epoch);
      saved.push(...result.data);
      for (let index = start; index < saved.length; index++) progress(index);
    }
    this.projections.refreshHeld();
    return { ok: true, data: saved };
  }

  // A parent this store has not seen passes: addCharacter writes a character's lore and avatar before
  // the character itself.
  private fits(kind: Kind, parent: string | null): boolean {
    const kinds = parentKinds(kind);
    if (kinds.length === 0 || parent === null) return kinds.length === 0 && parent === null;
    const held = this.live.get(parent);
    return !held || kinds.includes(held.kind as Kind);
  }

  private async pullPages({ signal = this.closing.signal, progress }: PullOptions): Promise<ApiFailure | null> {
    const stopped = () => signal.aborted || this.closing.signal.aborted;
    let more = true;
    let objects = 0;
    let pages = 0;
    let total: number | undefined;
    let counted = false;
    // The page after the one being applied, requested as soon as that one answered: the server's time and the codec's
    // overlap. It carries the epoch and timeline it was sent under, and is dropped when either moved.
    let next: { epoch: number; sent: string | null; answer: Promise<ApiResult<Page>> } | null = null;
    const page = (since: number, bootstrapped: boolean, known: number) => {
      const sent = this.timeline;
      // Only a bootstrap's first request asks for the count; the prefetched page after it is built before it answers.
      const count = !bootstrapped && !counted;
      counted ||= count;
      const answer = this.reaching(() => this.request<Page>('GET', `objects?since=${since}&exclude=${[...SCOPED].join(',')}${bootstrapped ? '' : `&bootstrap=1${this.bootstrap === null ? '' : `&until=${this.bootstrap}`}`}${count ? '&count=1' : ''}${this.cacheBounds(known)}${sent === null ? '' : `&timeline=${encodeURIComponent(sent)}`}`, undefined, signal), AbortSignal.any([signal, this.closing.signal, this.ended.signal]));
      return { epoch: this.epoch, sent, answer };
    };
    while (more) {
      if (this.opening) await this.opening;
      if (stopped()) return { ok: false, error: 'stopped' };
      const { epoch, sent, answer } = next?.epoch === this.epoch ? next : page(this.cursor, this.bootstrapped, this.known);
      next = null;
      const result = await answer;
      if (stopped()) return { ok: false, error: 'stopped' };
      if (epoch !== this.epoch) continue;
      if (!result.ok) {
        if (result.error === 'cache-reset') {
          this.rewind();
          continue;
        }
        return result;
      }
      // Sent with none, this is a bootstrap from 0 after a reset, and its answer names the timeline to hold. The server
      // refuses a request whose timeline is not its own, so no other answer can name another.
      if (sent === null) this.adopt(result.data.timeline);
      objects += result.data.changes.length;
      total ??= result.data.total;
      progress?.({ objects, pages: ++pages, waiting: this.waiting(), ...(total !== undefined && { total }) });
      this.limits = result.data.limits;
      this.bootstrap ??= result.data.until ?? null;
      // The cursor and bootstrap flag move after the page is applied (pullParent reads them); the next request is
      // computed from the page itself, with the revisions it carries already known.
      const after = { cursor: result.data.cursor, more: result.data.more, bootstrapped: this.bootstrapped };
      if (!after.more && !this.bootstrapped) {
        after.cursor = this.bootstrap ?? after.cursor;
        after.bootstrapped = true;
        after.more = true;
      }
      if (after.more) next = page(after.cursor, after.bootstrapped, result.data.changes.reduce((known, change) => Math.max(known, change.rev), this.known));
      const stop = AbortSignal.any([signal, this.closing.signal, this.ended.signal]);
      const opened = this.opener(result.data.changes, false, stop);
      for (const [index, change] of result.data.changes.entries()) {
        if (stopped()) {
          this.changed();
          return { ok: false, error: 'stopped' };
        }
        if (epoch !== this.epoch) break;
        try {
          await this.apply(change, () => opened(index), false, stop);
        } catch (error) {
          if (error instanceof CodecAborted && epoch !== this.epoch) break;
          if (error instanceof CodecAborted) this.changed();
          throw error;
        }
      }
      if (epoch !== this.epoch) continue;
      if (result.data.changes.length) this.changed();
      this.cursor = after.cursor;
      this.bootstrapped = after.bootstrapped;
      more = after.more;
      this.cacheWrite(result.data.changes);
    }
    for (const chat of [...this.behind]) {
      this.behind.delete(chat);
      // A chat already loading waits for this pull (pullParent) and reads its parent after it: waiting for it here
      // would wait for this pull itself.
      if (!this.scopes.has(chat) || this.scopes.get(chat)!.loading) continue;
      const failure = await this.refreshChat(chat);
      if (failure) return failure;
    }
    this.projections.refreshHeld();
    return stopped() ? { ok: false, error: 'stopped' } : null;
  }

  private async pullParent(chat: string, scope: Scope, signal: AbortSignal): Promise<ApiFailure | null> {
    if (!this.bootstrapped) {
      const failure = await this.pull();
      if (failure) return failure;
    }
    let more = true;
    while (more) {
      // A reset aborts every scope's signal, so the timeline is the one the pull above, or an earlier one, adopted.
      if (signal.aborted) return { ok: false, error: 'stopped' };
      const result = await this.reaching(() => this.request<Page>('GET', `objects?since=${scope.cursor}&parent=${encodeURIComponent(chat)}${this.cacheBounds()}&timeline=${encodeURIComponent(this.timeline!)}`, undefined, signal), signal);
      // An answer to a request sent before a reset is of the old timeline, a refusal too: it never resets the new one.
      if (signal.aborted) return { ok: false, error: 'stopped' };
      if (!result.ok) {
        if (result.error === 'cache-reset') this.rewind();
        return result;
      }
      this.limits = result.data.limits;
      const opened = this.opener(result.data.changes, true, signal);
      for (const [index, change] of result.data.changes.entries()) {
        if (signal.aborted) return { ok: false, error: 'stopped' };
        await this.apply(change, () => opened(index), true, signal);
        if (change.body && SCOPED.has(change.kind) && this.live.get(change.id)?.value === undefined) return { ok: false, error: 'unreadable' };
      }
      if (signal.aborted) return { ok: false, error: 'stopped' };
      scope.cursor = result.data.cursor;
      more = result.data.more;
      this.cacheWrite(result.data.changes, chat, scope, scope.state === 'loaded' || !more);
    }
    return null;
  }

  // Windows are dispatched ahead of the row being applied, one more than there are codec workers, so every worker
  // holds a window while the main thread applies an earlier one; only those windows' decoded values are retained. The
  // encoded-byte cap admits one atomic oversized object alone. Every window's promise gets an observer when dispatched:
  // a caller that stops consuming after an abort leaves no rejection unobserved. Strict scans preserve codec errors.
  // Outside a strict scan, a body that throws while opening counts as unreadable, as one that fails authentication does.
  private opener(rows: SealedChange[], scoped: boolean, signal: AbortSignal, strict = false): (index: number) => Promise<unknown> {
    type Window = { end: number; slots: Map<number, number>; batch: Promise<CodecResult[]> };
    const ahead = this.codec.workers + 1;
    const windows: Window[] = [];
    let next = 0;
    const dispatch = () => {
      const items: OpenItem[] = [];
      const slots = new Map<number, number>();
      let bytes = 0;
      for (; next < rows.length && items.length < OPEN_ITEMS; next++) {
        const { id, kind, parent, rev, body, omitted } = rows[next]!;
        if (typeof body !== 'string' || omitted || (!strict && ((SCOPED.has(kind) && !scoped) || this.stale(id, rev)))) continue;
        if (items.length && bytes + body.length > OPEN_BYTES) break;
        slots.set(next, items.length);
        items.push({ id, kind, parent, body });
        bytes += body.length;
      }
      const batch = items.length ? this.codec.open(items, signal) : Promise.resolve([]);
      batch.catch(() => {});
      windows.push({ end: next, slots, batch });
    };
    return async (index) => {
      while (windows.length && windows[0]!.end <= index) windows.shift();
      while (windows.length < ahead && next < rows.length) dispatch();
      const held = windows[0];
      const slot = held?.slots.get(index);
      if (held === undefined || slot === undefined) return undefined;
      const result = (await held.batch)[slot]!;
      return strict ? codecValue(result) : result.ok ? result.value : undefined;
    };
  }

  private async apply({ id, kind, parent, rev, body, omitted }: SealedChange, opened: () => Promise<unknown>, scoped: boolean, signal: AbortSignal) {
    if (signal?.aborted || this.closing.signal.aborted) return;
    this.recordRevision({ id, kind, parent, rev });
    if (scoped && kind === 'entry' && parent) {
      const scope = this.scopes.get(parent)!;
      scope.head = Math.max(scope.head, rev);
    }
    if (omitted || (SCOPED.has(kind) && !scoped)) {
      if (!parent || this.scopeState(parent) !== 'loaded') this.changes.push({ id, kind, parent });
      // This device's own writes come back here too, and are already held.
      else if (!this.stale(id, rev)) this.behind.add(parent);
      return;
    }
    if (this.stale(id, rev)) return;
    if (body === null) return this.drop(id, rev, { kind, id, parent });
    const epoch = this.epoch;
    const value = await opened();
    const upgraded = upgradeValue(kind, value);
    if (signal?.aborted || epoch !== this.epoch) return;
    if (upgraded) this.upgraded.set(id, kind);
    this.hold({ id, kind, parent, rev, value: upgraded ?? value });
  }

  private hold(object: Held) {
    this.recordRevision(object);
    if (object.kind === 'entry' && object.parent) {
      const scope = this.scopes.get(object.parent);
      if (scope) scope.head = Math.max(scope.head, object.rev);
    }
    if (this.closing.signal.aborted || this.stale(object.id, object.rev)) return;
    // A chat's entries and memory stay in memory only while the chat is held.
    if (SCOPED.has(object.kind) && !(object.parent && this.scopes.has(object.parent))) return;
    const previous = this.live.get(object.id);
    if (previous?.kind === 'entry' && previous.parent) this.scopes.get(previous.parent)?.fold.changed(object.id);
    if (object.kind === 'entry' && object.parent) this.scopes.get(object.parent)?.fold.changed(object.id);
    if (previous && (previous.kind !== object.kind || previous.parent !== object.parent)) this.changes.push({ kind: previous.kind, id: previous.id, parent: previous.parent });
    if (!SCOPED.has(object.kind) || (object.parent && this.scopeState(object.parent) === 'loaded')) this.changes.push({ kind: object.kind, id: object.id, parent: object.parent });
    this.forget(object.id);
    this.deleted.delete(object.id);
    this.live.set(object.id, object);
    if (object.value === undefined) this.unreadableCount++;
    const kind = this.byKind.get(object.kind);
    if (kind) kind.add(object.id);
    else this.byKind.set(object.kind, new Set([object.id]));
    if (object.parent === null) return;
    let children = this.byParent.get(object.parent);
    if (!children) this.byParent.set(object.parent, (children = new Map()));
    const siblings = children.get(object.kind);
    if (siblings) siblings.add(object.id);
    else children.set(object.kind, new Set([object.id]));
  }

  private drop(id: string, rev: number, change: StoreChange) {
    this.recordRevision({ ...change, rev });
    if (change.kind === 'entry' && change.parent) {
      const scope = this.scopes.get(change.parent);
      if (scope) scope.head = Math.max(scope.head, rev);
    }
    if (this.stale(id, rev)) return;
    const previous = this.live.get(id);
    if (change.kind === 'entry' && change.parent) this.scopes.get(change.parent)?.fold.changed(id);
    this.changes.push(previous ? { kind: previous.kind, id, parent: previous.parent } : change);
    this.forget(id);
    this.deleted.set(id, rev);
  }

  // Every write takes the account's next rev, so one not above the rev held for the id is that write or an older
  // one arriving late. Also checked after apply's await: a write can land while a pulled body decrypts.
  private stale(id: string, rev: number): boolean {
    const known = this.live.get(id)?.rev ?? this.deleted.get(id);
    return known !== undefined && rev <= known;
  }

  private forget(id: string) {
    const held = this.live.get(id);
    if (!held) return;
    if (held.value === undefined) this.unreadableCount--;
    const kind = this.byKind.get(held.kind)!;
    kind.delete(id);
    if (!kind.size) this.byKind.delete(held.kind);
    if (held.parent !== null) {
      const children = this.byParent.get(held.parent)!;
      const siblings = children.get(held.kind)!;
      siblings.delete(id);
      if (!siblings.size) children.delete(held.kind);
      if (!children.size) this.byParent.delete(held.parent);
    }
    this.live.delete(id);
  }

  private recordRevision({ kind, parent, rev }: StoreChange & { rev: number }) {
    this.known = Math.max(this.known, rev);
    for (const read of [{ kind, list: true }, ...(parent ? [{ kind, parent }] : [])]) {
      const key = JSON.stringify(read);
      this.revisions.set(key, Math.max(this.revisions.get(key) ?? 0, rev));
    }
    if (kind === 'entry' && parent) this.heads.set(parent, Math.max(this.heads.get(parent) ?? 0, rev));
  }

  private scopeChanged(chat: string) {
    this.changes.push({ kind: 'scope', id: chat, parent: chat });
    this.changed();
  }

  private changed() {
    if (!this.changes.length) return;
    // A confirmed write is told twice over, by hold and by its overlay going.
    const changes = [...new Map(this.changes.splice(0).map((change) => [`${change.kind}\n${change.id}\n${change.parent}`, change])).values()];
    for (const listener of this.listeners) listener(changes);
  }
}

export function keepSynced(store: ObjectStore, synced: () => void): () => void {
  const pull = () => {
    if (document.visibilityState === 'visible') void store.pull().then((failure) => { if (!failure) synced(); });
  };
  const timer = setInterval(pull, 30_000);
  window.addEventListener('focus', pull);
  return () => {
    clearInterval(timer);
    window.removeEventListener('focus', pull);
  };
}
