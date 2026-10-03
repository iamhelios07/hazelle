import { KINDS, parentKinds, type AppendOnly, type Kind, type Singleton, type Stored, type Values } from '../model/kinds';
import { objectKey } from '../vault/objects';
import type { VaultKey } from '../vault/keys';
import type { ApiFailure, ApiResult, api as realApi } from './api';
import { pause } from './pause';
import { CodecAborted, CodecUnavailable, ObjectCodec, OPEN_BYTES, OPEN_ITEMS, SEAL_ITEMS } from './object-codec';
import { codecValue, type CodecResult, type OpenItem, type SealItem } from './object-codec-core';
import { orderOwned } from './removal';
import { GenerationChanged, SCOPED, type CachedScope, type CacheState, type CacheWrite, type DeviceCache, type Generation, type SealedChange } from './object-cache';
import { Evaluation, EvaluationFailed, EvaluationStopped } from './evaluation';
import { projectChat, summaryId, summaryStale, type Projection } from './summary';

type Api = typeof realApi;
export type ObjectRow = { id: string; kind: string; parent: string | null; rev: number };
export type StoreChange = { kind: string; id: string; parent: string | null };
export type StoreRead = { kind: Kind; id: string } | { kind: Kind; list: true } | { kind: Kind; parent: string };
export type PullProgress = { objects: number; pages: number };
type PullOptions = { signal?: AbortSignal; progress?: (progress: PullProgress) => void };

export const readsChanged = (reads: StoreRead[], changes: readonly StoreChange[]) =>
  reads.some((read) => changes.some((change) => read.kind === change.kind && ('list' in read || ('id' in read ? read.id === change.id : read.parent === change.parent))));

type Limits = { items: number; bytes: number; body: number };
type Page = { timeline: string; until?: number; changes: SealedChange[]; cursor: number; more: boolean; limits: Limits };
// What a workflow runs on from its start to its end: the server's timeline and this store's epoch (pinned).
export type Pin = { timeline: string; epoch: number };
const changed = (): ApiFailure => ({ ok: false, error: 'timeline-changed' });
type ObjectValue = Omit<Stored<Kind>, 'rev'>;
export type Write = (ObjectValue & { type: 'create' | 'restore' }) | { type: 'remove'; id: string };
type Pending = { id: string; kind: string; parent: string | null; value: unknown; baseRev: number | null };
type Resolved = { pending: Pending | null; held: Held | null };
// derived: a write the store makes on its own (a summary), which is not counted among the person's dropped writes.
type Step = { resolve: () => ApiResult<Resolved>; derived?: boolean };

// value is undefined for a body that did not open. Such an object is counted, never
// shown as if it were empty, and never overwritten. kind may be one a newer version wrote.
type Held = { id: string; kind: string; parent: string | null; rev: number; value: unknown };

const MAX_ATTEMPTS = 3;
// Pauses between tries of a write that could not reach the server; the last repeats until it does.
const RECONNECT_PAUSES = [1000, 2000, 4000, 8000, 15000];
// A write waits these out as it waits for a dropped connection; a 503 says when to try again (retryAfter, in seconds).
const WAITED = new Set(['offline', 'account-restoring', 'store-unavailable']);
const waits = (result: ApiResult<unknown> | null): result is ApiFailure => result?.ok === false && WAITED.has(result.error);
export type ScopeState = 'unloaded' | 'loading' | 'loaded' | 'failed';
type Scope = { opening: Promise<ApiFailure | null> | null; abort: AbortController; state: ScopeState; users: number; cursor: number; head: number; loading: Promise<ApiFailure | null> | null; error: ApiFailure | null };
export type ChatLease = { ready: Promise<ApiFailure | null>; release: () => void };

export class ScopeUnavailable extends Error {
  constructor(readonly chat: string | null) { super(`Chat scope is not loaded: ${chat ?? 'unknown'}`); }
}

// The browser's copy of the account's objects, decrypted in memory. The server stays the only source
// of truth: writes go to it first, and a version conflict is resolved by pulling the
// newer copy and applying the change again on top of it.
export class ObjectStore {
  private readonly closing = new AbortController();
  private readonly live = new Map<string, Held>();
  private readonly deleted = new Map<string, number>();
  private readonly byKind = new Map<string, Set<string>>();
  private readonly byParent = new Map<string, Map<string, Set<string>>>();
  private unreadableCount = 0;
  private readonly listeners = new Set<(changes: readonly StoreChange[]) => void>();
  private readonly waitListeners = new Set<() => void>();
  private waitingWrites = 0;
  private readonly changes: StoreChange[] = [];
  private reading: StoreRead[] | null = null;
  private cursor = 0;
  private bootstrap: number | null = null;
  private bootstrapped = false;
  private readonly scopes = new Map<string, Scope>();
  private readonly heads = new Map<string, number>();
  private readonly revisions = new Map<string, number>();
  readonly evaluation = new Evaluation();
  private readonly projecting = new Map<string, Promise<Projection | null>>();
  private readonly projections = new Map<string, Projection>();
  private readonly summarizing = new Map<string, Promise<ApiFailure | null>>();
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
  // The cache generation this tab holds (object-cache).
  private generation: Generation | null = null;
  // A reload from the cache after another tab moved its generation, which a pull waits for before its next request.
  private opening: Promise<void> | null = null;
  // Per commit under way, how many of the person's writes in it the server has not taken.
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
  ) { this.codec = new ObjectCodec(accountId, key); }

  static async open(accountId: string, vaultKey: VaultKey, request: Api, cache?: DeviceCache, signal?: AbortSignal): Promise<ObjectStore> {
    const store = new ObjectStore(accountId, await objectKey(vaultKey), request, cache);
    await store.load(store.epoch, signal);
    return store;
  }

  // What a page load does: take the stored cache generation, and its rows when it has a timeline.
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

  // Another tab moved the cache to a generation of its own: this one drops what it holds, loads that generation and
  // catches up from it.
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
    let dropped = 0;
    for (const unsent of this.unsent) dropped += unsent();
    this.unsent.clear();
    const held = this.timeline !== null;
    this.timeline = null;
    this.epoch++;
    this.ended.abort();
    this.ended = new AbortController();
    for (const object of this.live.values()) this.changes.push({ kind: object.kind, id: object.id, parent: object.parent });
    for (const [chat, scope] of this.scopes) {
      scope.abort.abort();
      scope.abort = new AbortController();
      scope.state = 'unloaded';
      scope.cursor = scope.head = 0;
      scope.loading = scope.opening = null;
      this.behind.add(chat);
    }
    this.live.clear();
    this.deleted.clear();
    this.byKind.clear();
    this.byParent.clear();
    this.heads.clear();
    this.revisions.clear();
    this.projections.clear();
    this.projecting.clear();
    this.unreadableCount = this.cursor = this.known = 0;
    this.bootstrap = null;
    this.bootstrapped = this.restored = false;
    this.limits = null;
    this.changed();
    if (heard && (held || dropped)) for (const listener of this.rewoundListeners) listener(dropped);
  }

  private cacheBounds() {
    return this.cache ? `&known=${this.known}` : '';
  }

  readonly subscribe = (listener: (changes: readonly StoreChange[]) => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  // True while a write waits for the server to be reachable again.
  readonly waiting = () => this.waitingWrites > 0;

  readonly subscribeWaiting = (listener: () => void) => {
    this.waitListeners.add(listener);
    return () => this.waitListeners.delete(listener);
  };

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

  get<K extends Kind>(kind: K, id: string): Stored<K> | null {
    this.reading?.push({ kind, id });
    const held = this.live.get(id);
    if (SCOPED.has(kind) && (!held?.parent || this.scopeState(held.parent) !== 'loaded')) throw new ScopeUnavailable(held?.parent ?? null);
    return held && held.kind === kind && held.value !== undefined ? (held as Stored<K>) : null;
  }

  list<K extends Kind>(kind: K): Stored<K>[] {
    if (SCOPED.has(kind)) throw new ScopeUnavailable(null);
    this.reading?.push({ kind, list: true });
    return [...(this.byKind.get(kind) ?? [])].map((id) => this.live.get(id)!).filter((held): held is Stored<K> => held.value !== undefined);
  }

  children<K extends Kind>(kind: K, parent: string): Stored<K>[] {
    if (SCOPED.has(kind) && this.scopeState(parent) !== 'loaded') throw new ScopeUnavailable(parent);
    this.reading?.push({ kind, parent });
    return [...(this.byParent.get(parent)?.get(kind) ?? [])].map((id) => this.live.get(id)!).filter((held): held is Stored<K> => held.value !== undefined);
  }

  close() {
    this.closing.abort();
    this.codec.close();
    this.evaluation.close();
    for (const scope of this.scopes.values()) scope.abort.abort();
    this.listeners.clear();
    this.rewoundListeners.clear();
    this.live.clear();
    this.byKind.clear();
    this.byParent.clear();
    this.projections.clear();
    this.projecting.clear();
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

  projection(chat: string): Projection | null {
    return this.scopeState(chat) === 'loaded' ? this.projections.get(chat) ?? null : null;
  }

  async evaluated(chat: string): Promise<Projection | null> {
    const pending = this.projecting.get(chat);
    if (pending) { await pending; return this.evaluated(chat); }
    const loading = this.scopes.get(chat)?.loading;
    if (loading) { if (await loading) return null; return this.evaluated(chat); }
    if (this.scopeState(chat) !== 'loaded') return null;
    const previous = this.projections.get(chat);
    if (previous && !summaryStale(this, chat, previous.summary, this.loadedHead(chat))) return previous;
    const epoch = this.epoch;
    const scope = this.scopes.get(chat)!;
    const work = (async () => {
      for (;;) {
        const next = await projectChat(this, chat, this.projections.get(chat), AbortSignal.any([scope.abort.signal, this.ended.signal, this.closing.signal])).catch((error: unknown) => {
          this.failScope(chat, scope, epoch, error);
          throw error;
        });
        if (epoch !== this.epoch || this.scopes.get(chat) !== scope || scope.state !== 'loaded' || this.closing.signal.aborted) return null;
        if (scope.loading) return this.projections.get(chat) ?? null;
        if (next && summaryStale(this, chat, next.summary, this.loadedHead(chat))) continue;
        if (next) this.projections.set(chat, next);
        else this.projections.delete(chat);
        this.changes.push({ kind: 'projection', id: chat, parent: chat });
        this.changed();
        return next;
      }
    })();
    this.projecting.set(chat, work);
    let result: Projection | null;
    try { result = await work; }
    finally { if (this.projecting.get(chat) === work) this.projecting.delete(chat); }
    return scope.loading ? this.evaluated(chat) : result;
  }

  // A write or a pull is done once the server took it; the held chats' projections follow. Whoever reads a chat as the
  // write left it waits for evaluated(chat), and a projection that fails is shown on its chat's scope, never as the
  // write's failure.
  private refreshHeld() {
    const epoch = this.epoch;
    for (const [chat, scope] of this.scopes) {
      if (scope.state === 'loaded' && !scope.loading) void this.evaluated(chat).catch((error: unknown) => void this.codecFailure(error, epoch));
    }
  }

  // A held chat that could not be opened or evaluated: its screen says so and offers 다시 시도 (useChatModel).
  private failScope(chat: string, scope: Scope, epoch: number, error: unknown): ApiFailure {
    const failure = this.codecFailure(error, epoch);
    if (this.scopes.get(chat) === scope && epoch === this.epoch && !this.closing.signal.aborted) {
      scope.state = 'failed';
      scope.error = failure;
      this.changes.push({ kind: 'scope', id: chat, parent: chat });
      this.changed();
    }
    return failure;
  }

  // created: the caller is writing this chat's first objects under a new id, so the server has nothing to pull for it.
  retainChat(chat: string, created = false): ChatLease {
    if (this.closing.signal.aborted) return { ready: Promise.resolve({ ok: false, error: 'stopped' }), release: () => {} };
    let scope = this.scopes.get(chat);
    if (!scope) {
      scope = { opening: null, abort: new AbortController(), state: created ? 'loaded' : 'unloaded', users: 0, cursor: 0, head: 0, loading: null, error: null };
      this.scopes.set(chat, scope);
      if (created) this.cacheWrite([], chat, scope, true);
    }
    scope.users++;
    const held = scope;
    if (held.state !== 'loaded' && !held.opening) {
      const epoch = this.epoch;
      const opening = this.openChat(chat, held).catch((error: unknown) => this.failScope(chat, held, epoch, error)).finally(() => { if (held.opening === opening) held.opening = null; });
      held.opening = opening;
    }
    const epoch = this.epoch;
    const ready = held.opening ?? (held.loading ? Promise.resolve(null) : this.evaluated(chat).then(() => null, (error: unknown) => this.codecFailure(error, epoch)));
    let released = false;
    return { ready, release: () => {
      if (released) return;
      released = true;
      held.users--;
      if (!held.users) this.releaseChat(chat, held);
    } };
  }

  private async openChat(chat: string, scope: Scope): Promise<ApiFailure | null> {
    const epoch = this.epoch;
    const signal = AbortSignal.any([scope.abort.signal, this.closing.signal, this.ended.signal]);
    scope.state = 'loading';
    this.changes.push({ kind: 'scope', id: chat, parent: chat });
    this.changed();
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
          this.changes.push({ kind: 'scope', id: chat, parent: chat });
          this.changed();
          return scope.error;
        }
      }
      if (signal.aborted) return this.halted(epoch);
      if (saved.state.complete && !saved.changes.some((row) => row.omitted)) {
        scope.state = 'loaded';
        await this.evaluated(chat);
        this.changes.push({ kind: 'scope', id: chat, parent: chat });
        this.changed();
        // Ready is cache-only; catch-up and summary writes must not hold the chat screen behind the network.
        void this.refreshChat(chat).then((failure) => { if (!failure && scope.users) this.summarizeChat(chat); });
        return null;
      }
    }
    const failure = await this.refreshChat(chat);
    return failure ?? await this.saveSummary(chat);
  }

  // What an operation begun in epoch answers when it is cut short: timeline-changed once a reset has ended that epoch,
  // stopped for the store closing, the caller's own stop and a released lease.
  private halted(epoch: number): ApiFailure {
    return epoch !== this.epoch && !this.closing.signal.aborted ? changed() : { ok: false, error: 'stopped' };
  }

  private codecFailure(error: unknown, epoch: number): ApiFailure {
    if (error instanceof EvaluationStopped || error instanceof CodecAborted) return this.halted(epoch);
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

  // signal: the caller's stop, seen once the chat is ready; the lease is held until run ends, so run never finds its
  // chat let go under it.
  async withChat<T>(chat: string, run: () => Promise<ApiResult<T>>, signal?: AbortSignal): Promise<ApiResult<T>> {
    if (signal?.aborted) return { ok: false, error: 'stopped' };
    const lease = this.retainChat(chat);
    try {
      const failure = await lease.ready;
      return signal?.aborted ? { ok: false, error: 'stopped' } : failure ?? await run();
    } finally { lease.release(); }
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
        try { await this.evaluated(chat); }
        catch (error) { failure = this.codecFailure(error, epoch); }
      }
      this.changes.push({ kind: 'scope', id: chat, parent: chat });
      this.changed();
      return failure;
    });
    this.changes.push({ kind: 'scope', id: chat, parent: chat });
    this.changed();
    return scope.loading;
  }

  private releaseChat(chat: string, scope: Scope) {
    scope.abort.abort();
    scope.loading = null;
    for (const kind of SCOPED) {
      for (const id of [...(this.byParent.get(chat)?.get(kind) ?? [])]) this.forget(id);
    }
    this.projections.delete(chat);
    for (const lane of ['projection', 'headless', 'send', 'forecast', 'memory', 'view']) this.evaluation.forget(`${lane}:${chat}`);
    scope.state = 'unloaded';
    scope.cursor = 0;
    scope.head = 0;
    scope.error = null;
    if (this.scopes.get(chat) === scope) this.scopes.delete(chat);
    this.changes.push({ kind: 'scope', id: chat, parent: chat });
    this.changed();
  }

  async saveSummary(chat: string): Promise<ApiFailure | null> {
    const pending = this.summarizing.get(chat);
    if (pending) return pending;
    const epoch = this.epoch;
    const save = async (): Promise<ApiFailure | null> => {
      for (;;) {
        // The scope's own controller, ended when its last lease is let go, the timeline resets or the store closes: no
        // retry of a summary write outlives the chat being held.
        const scope = this.scopes.get(chat);
        if (!scope || scope.abort.signal.aborted) return this.halted(epoch);
        if (this.loadedHead(chat) < this.entryHead(chat)) {
          const failed = await this.refreshChat(chat);
          if (failed) return failed;
        }
        const write = await this.summaryWrite(chat);
        if (!write) return null;
        const result = await this.commit([this.step(write)], undefined, scope.abort.signal);
        if (!result.ok) return result;
      }
    };
    const saving = save().catch((error: unknown) => this.codecFailure(error, epoch)).finally(() => this.summarizing.delete(chat));
    this.summarizing.set(chat, saving);
    return saving;
  }

  private async summaryWrite(chat: string): Promise<Write | null> {
    const projection = await this.evaluated(chat);
    if (!projection) return null;
    const id = summaryId(chat);
    const current = this.get('summary', id);
    if (current && !summaryStale(this, chat, current.value) && current.value.title === projection.summary.title && current.value.preview === projection.summary.preview) return null;
    // The projection's source versions travel with it. A concurrent edit can never make an old summary look current.
    return { type: 'restore', id, kind: 'summary', parent: chat, value: projection.summary };
  }

  // An explicit account/parent walk; it never fills the held chat scopes. Backup and ownership walks run on their
  // workflow's pin (pinned); usage reads on a bare pin, since it writes nothing. No row is visited once the pin's epoch
  // has ended.
  async scan(options: { parent?: string; metadata?: boolean }, visit: (row: ObjectRow, value: unknown) => void | Promise<void>, pin: Pin, signal?: AbortSignal): Promise<ApiFailure | null> {
    const stop = AbortSignal.any([this.closing.signal, this.ended.signal, ...(signal ? [signal] : [])]);
    let cursor = 0;
    let more = true;
    while (more) {
      if (pin.epoch !== this.epoch || stop.aborted) return this.halted(pin.epoch);
      const result = await this.request<Page>('GET', `objects?since=${cursor}${options.parent ? `&parent=${encodeURIComponent(options.parent)}` : ''}${options.metadata ? '&metadata=1' : ''}&timeline=${encodeURIComponent(pin.timeline)}`, undefined, stop);
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
    const removed = await this.commit(rows.map((row) => ({ resolve: () => {
      const held = this.live.get(row.id);
      if (!held && (this.deleted.get(row.id) ?? 0) >= row.rev) return { ok: true, data: { pending: null, held: null } };
      return { ok: true, data: { pending: { ...row, value: undefined, baseRev: held?.rev ?? row.rev }, held: null } };
    } })));
    return removed.ok ? { ok: true, data: null } : removed;
  }

  unreadable(): number {
    return this.unreadableCount;
  }

  // The timeline and epoch held now. A store holding no timeline pulls one first, as one about to write does.
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
    const epoch = this.epoch;
    this.pulling ??= this.pullPages(options).catch((error: unknown) => this.codecFailure(error, epoch)).finally(() => (this.pulling = null));
    return this.pulling;
  }

  // One user action's writes, owned objects before their owners and in the order given within a kind, so an owner
  // appears only once whole and a chat's entries keep their rev order, which model/chat fold reads. An action
  // larger than one request goes as several, the owner in the last; one cut short leaves only unreachable pieces.
  // unheld: the writes' chats are not held or summarized (a restore writing entries before their chats); their next
  // lease pulls what was written. signal: the caller's stop, which also ends a wait for the connection to return.
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
    const leases = [...chats].map((chat) => this.retainChat(chat, created.has(chat)));
    try {
      for (const lease of leases) {
        const failure = await lease.ready;
        if (failure) return failure;
      }
      const result = await this.commit(ordered.map((write) => this.step(write)), (index) => progress(ordered[index]!), signal);
      if (!result.ok) return result;
      this.summarizeHeld();
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
      resolve: () => {
        const held = this.live.get(id);
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
      resolve: () => {
        const held = this.live.get(id);
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

  // Answers the removed object, which restore (되돌리기) writes back.
  async take<K extends Kind>(kind: K, id: string): Promise<ApiResult<Stored<K>>> {
    const object = this.get(kind, id);
    if (!object) return { ok: false, error: 'gone' };
    const removed = await this.remove(id);
    return removed.ok ? { ok: true, data: object } : removed;
  }

  // Summaries follow a write unawaited: one that fails stays stale, and the chat's next opening (retainChat) writes it
  // again. Only held chats are summarized; any write can change what they display.
  private summarizeHeld() {
    for (const [chat, scope] of this.scopes) {
      if (scope.state !== 'loaded') continue;
      this.summarizeChat(chat);
    }
  }

  private summarizeChat(chat: string) {
    const lease = this.retainChat(chat);
    void lease.ready.then((failure) => failure ?? this.saveSummary(chat)).finally(lease.release);
  }

  // chat: a scoped write's chat, held for the base revision of what the write changes.
  private async writeOne<K extends Kind>(step: Step, chat: string | null): Promise<ApiResult<Stored<K>>> {
    const lease = chat ? this.retainChat(chat) : null;
    try {
      const failure = await lease?.ready;
      if (failure) return failure;
      const result = await this.one<K>(step);
      if (result.ok) this.summarizeHeld();
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
      derived: write.type !== 'remove' && write.kind === 'summary',
      resolve: () => {
        const held = this.live.get(write.id);
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

  // A write that cannot reach the server waits and tries again until it does, or until stop (the store closing, the
  // caller's stop, or a reset) ends it: a dropped connection, a restore under way or a store not answering yet does not
  // fail it. A try whose answer was lost after it landed comes back as a conflict and is
  // applied again, so an update's change must read the same applied twice as once (set a value, never add to one).
  // A file's upload (runtime/files) waits the same way, and shows as the same waiting.
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
    this.waitingWrites += by;
    for (const listener of this.waitListeners) listener();
  }

  private async commit(steps: Step[], progress: (index: number) => void = () => {}, signal?: AbortSignal): Promise<ApiResult<(Held | null)[]>> {
    const stop = signal ? AbortSignal.any([this.closing.signal, signal]) : this.closing.signal;
    if (stop.aborted) return { ok: false, error: 'stopped' };
    const epoch = this.epoch;
    const saved: (Held | null)[] = [];
    const unsent = () => steps.slice(saved.length).filter((step) => !step.derived).length;
    this.unsent.add(unsent);
    try {
      return await this.send(steps, saved, progress, stop);
    } catch (error) {
      return this.codecFailure(error, epoch);
    } finally {
      this.unsent.delete(unsent);
    }
  }

  private async send(steps: Step[], saved: (Held | null)[], progress: (index: number) => void, stop: AbortSignal): Promise<ApiResult<(Held | null)[]>> {
    const pinned = await this.pin(stop);
    if (!pinned.ok) return pinned;
    const { timeline, epoch } = pinned.data;
    if ([...this.workflows].some((workflow) => workflow.epoch !== epoch)) return changed();
    const limits = this.limits!;
    const halt = AbortSignal.any([stop, this.ended.signal]);
    while (saved.length < steps.length) {
      const start = saved.length;
      const result = await this.retry(async (): Promise<ApiResult<(Held | null)[]>> => {
        const resolved: Resolved[] = [];
        const writes: { id: string; kind: string; parent: string | null; baseRev: number | null; body: string | null }[] = [];
        let bytes = new TextEncoder().encode(JSON.stringify({ timeline, writes: [] })).length;
        // Resolve and seal afresh INSIDE every retry. Keep only a small value window, not the server's entire
        // item page. Future failures stay in their slots until the byte-limited prefix reaches them.
        filling: for (let from = start; from < Math.min(steps.length, start + limits.items); from += SEAL_ITEMS) {
          if (halt.aborted) return this.halted(epoch);
          const window = steps.slice(from, Math.min(from + SEAL_ITEMS, start + limits.items)).map((step) => {
            try { return { ready: step.resolve() }; }
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
              const size = new TextEncoder().encode(JSON.stringify(write)).length + (writes.length ? 1 : 0);
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
          this.changed();
        }
        return { ok: true, data: resolved.map(({ held }) => held) };
      }, halt);
      if (!result.ok) return epoch === this.epoch ? result : this.halted(epoch);
      saved.push(...result.data);
      for (let index = start; index < saved.length; index++) progress(index);
    }
    this.refreshHeld();
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
    while (more) {
      if (this.opening) await this.opening;
      if (stopped()) return { ok: false, error: 'stopped' };
      const epoch = this.epoch;
      const sent = this.timeline;
      const result = await this.request<Page>('GET', `objects?since=${this.cursor}&exclude=entry,memory${this.bootstrapped ? '' : `&bootstrap=1${this.bootstrap === null ? '' : `&until=${this.bootstrap}`}`}${this.cacheBounds()}${sent === null ? '' : `&timeline=${encodeURIComponent(sent)}`}`, undefined, signal);
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
      progress?.({ objects, pages: ++pages });
      this.limits = result.data.limits;
      this.bootstrap ??= result.data.until ?? null;
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
      this.cursor = result.data.cursor;
      more = result.data.more;
      if (result.data.changes.length) this.changed();
      if (!more && !this.bootstrapped) {
        this.cursor = this.bootstrap ?? this.cursor;
        this.bootstrapped = true;
        more = true;
      }
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
    this.refreshHeld();
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
      const result = await this.request<Page>('GET', `objects?since=${scope.cursor}&parent=${encodeURIComponent(chat)}${this.cacheBounds()}&timeline=${encodeURIComponent(this.timeline!)}`, undefined, signal);
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

  // Whole windows refill on demand, not one new RPC per consumed row. Only one window of decoded values is
  // retained; the encoded-byte cap admits one atomic oversized object alone. A batch has one promise, so skipping
  // a row that became stale cannot leave a future item's rejection unobserved. Strict scans preserve codec errors.
  // Outside a strict scan, a body that throws while opening counts as unreadable, as one that fails authentication does.
  private opener(rows: SealedChange[], scoped: boolean, signal: AbortSignal, strict = false): (index: number) => Promise<unknown> {
    let end = 0;
    let slots = new Map<number, number>();
    let batch: Promise<CodecResult[]> = Promise.resolve([]);
    return async (index) => {
      if (index >= end) {
        const items: OpenItem[] = [];
        slots = new Map();
        let bytes = 0;
        for (end = index; end < rows.length && items.length < OPEN_ITEMS; end++) {
          const { id, kind, parent, rev, body, omitted } = rows[end]!;
          if (typeof body !== 'string' || omitted || (!strict && ((SCOPED.has(kind) && !scoped) || this.stale(id, rev)))) continue;
          if (items.length && bytes + body.length > OPEN_BYTES) break;
          slots.set(end, items.length);
          items.push({ id, kind, parent, body });
          bytes += body.length;
        }
        batch = items.length ? this.codec.open(items, signal) : Promise.resolve([]);
      }
      const results = await batch;
      const slot = slots.get(index);
      if (slot === undefined) return undefined;
      const result = results[slot]!;
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
    if (!signal?.aborted && epoch === this.epoch) this.hold({ id, kind, parent, rev, value });
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

  private changed() {
    if (!this.changes.length) return;
    const changes = this.changes.splice(0);
    for (const listener of this.listeners) listener(changes);
  }
}

// A copy without key, for an update that clears an optional field.
export function without<T extends object>(from: T, key: keyof T): T {
  const rest = { ...from };
  delete rest[key];
  return rest;
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
