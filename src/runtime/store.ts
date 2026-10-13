import { ChatFold } from '../model/chat';
import type { AppendOnly, Kind, Singleton, Stored, Values } from '../model/kinds';
import { objectKey } from '../vault/objects';
import type { VaultKey } from '../vault/keys';
import type { ApiFailure, ApiResult, api as realApi } from './api';
import { ConnectionWait } from './connection-wait';
import { StoreChanges } from './store-changes';
import { CodecAborted, CodecUnavailable, ObjectCodec } from './object-codec';
import { SCOPED, UNFED, WALKED, type CacheState, type DeviceCache, type SealedChange } from './object-cache';
import { ObjectCacheSession } from './object-cache-session';
import { Evaluation, EvaluationFailed, EvaluationStopped, EvaluationStuck } from './evaluation';
import { ChatProjections } from './summary';
import { ScopeUnavailable, type ChatLease, type ScopeState } from './chat-scope';
import { ObjectIndex, type Held, type StoreChange, type StoreRead } from './object-index';
import { ObjectWrites, type Limits, type Pending, type Resolved, type Write, type WriteStep } from './object-writes';
import { PendingWrites, chatOf, type Overlay, type PendingCommit } from './pending-writes';
import { upgradeValue } from './upgrade';

type Api = typeof realApi;
export type ObjectRow = { id: string; kind: string; parent: string | null; rev: number };
// total: what the whole bootstrap holds, once its first page said; an incremental pull has none.
export type PullProgress = { objects: number; pages: number; waiting: boolean; total?: number };
type PullOptions = { signal?: AbortSignal; progress?: (progress: PullProgress) => void };

type Page = { timeline: string; until?: number; changes: SealedChange[]; cursor: number; more: boolean; limits: Limits; total?: number };
export type Pin = { timeline: string; epoch: number };
const changed = (): ApiFailure => ({ ok: false, error: 'timeline-changed' });
const MAX_ATTEMPTS = 3;
type Scope = { fold: ChatFold; opening: Promise<ApiFailure | null> | null; abort: AbortController; state: ScopeState; users: number; cursor: number; head: number; loading: Promise<ApiFailure | null> | null; error: ApiFailure | null; summarize: boolean };
// The server stays the only source of truth: writes go to it first, and a version conflict is resolved by pulling the
// newer copy and applying the change again on top of it.
export class ObjectStore {
  private readonly closing = new AbortController();
  private readonly objects = new ObjectIndex();
  private readonly pending = new PendingWrites(this.objects);
  private readonly upgraded = new Map<string, string>();
  private readonly changes = new StoreChanges();
  private readonly connection = new ConnectionWait();
  private cursor = 0;
  private bootstrap: number | null = null;
  private bootstrapped = false;
  private readonly scopes = new Map<string, Scope>();
  readonly evaluation = new Evaluation({ verdict: (chat) => this.changes.unrecorded(() => this.projections.verdict(chat) !== null), judged: (chat) => this.projections.judge(chat) });
  readonly projections: ChatProjections;
  private readonly behind = new Set<string>();
  private limits: Limits | null = null;
  private pulling: Promise<ApiFailure | null> | null = null;
  // The server's token for the account's history (server/account-store), replaced by every restore there. Sent with
  // every feed and batch, adopted only from the answer to a bootstrap sent with none, and cleared by reset.
  private timeline: string | null = null;
  // The local generation, not the server's timeline: every reset ends one, and work begun in it is cancelled.
  private epoch = 0;
  private ended = new AbortController();
  private readonly workflows = new Set<Pin>();
  private readonly rewoundListeners = new Set<(dropped: number) => void>();
  private known = 0;
  private restored = false;
  private openingFailure: ApiFailure | null = null;
  private readonly cachedObjects: ObjectCacheSession;
  private readonly codec: ObjectCodec;
  private readonly writes: ObjectWrites;

  private constructor(
    accountId: string,
    key: CryptoKey,
    private readonly request: Api,
    cache?: DeviceCache,
  ) {
    this.cachedObjects = new ObjectCacheSession(cache, () => this.reopen());
    this.codec = new ObjectCodec(accountId, key);
    this.writes = new ObjectWrites(this.objects, this.codec);
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
      showing: (chat) => this.pending.showing(chat),
      refresh: (chat) => this.refreshChat(chat),
      retain: (chat) => this.retainChat(chat),
      write: async (writes, signal) => {
        const result = await this.commit(writes.map((write) => this.writes.step(write)), undefined, signal);
        return result.ok ? null : result;
      },
      publish: (chat) => {
        this.changes.add({ kind: 'projection', id: chat, parent: chat });
        this.changes.publish();
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
    // A reload queued behind an epoch that has since ended reads nothing: the session's generation is the new epoch's.
    if (!this.cachedObjects.available || epoch !== this.epoch) return;
    const stop = AbortSignal.any([this.closing.signal, this.ended.signal, ...(signal ? [signal] : [])]);
    try {
      const openedCache = await this.cachedObjects.open(this.ended.signal);
      if (!openedCache) return;
      const { generation, saved } = openedCache;
      this.timeline = generation.timeline;
      if (!saved) return;
      const { state } = saved;
      this.cursor = state.cursor;
      this.bootstrap = state.until;
      this.bootstrapped = state.complete;
      this.limits = state.limits;
      this.objects.loadRevisions(state);
      this.known = Math.max(state.cursor, state.until ?? 0);
      for (const [, rev] of [...state.heads, ...state.revisions]) this.known = Math.max(this.known, rev);
      const rows = saved.changes.sort((a, b) => a.rev - b.rev);
      const opened = this.opener(rows, false, stop);
      for (const [index, row] of rows.entries()) {
        if (stop.aborted || epoch !== this.epoch) return;
        await this.apply(row, () => opened(index), false, stop);
      }
      this.changes.publish();
      this.restored = true;
    } catch (error) {
      // Cancellation and a failed worker say nothing about the validity of the encrypted device copy.
      if (error instanceof CodecAborted) return;
      if (error instanceof CodecUnavailable) {
        this.openingFailure = this.codecFailure(error, epoch);
        return;
      }
      this.cachedObjects.disable();
      this.reset(false);
    }
  }

  get cached(): boolean { return this.restored; }

  private cacheState(scope?: { cursor: number; complete: boolean }): CacheState {
    return {
      cursor: scope?.cursor ?? this.cursor,
      complete: scope ? scope.complete : this.bootstrapped,
      until: scope ? null : this.bootstrap,
      limits: this.limits,
      ...(scope ? { heads: [], revisions: [] } : this.objects.snapshotRevisions()),
    };
  }

  // scope: the parent whose rows were read up to cursor (a chat's, or a walked kind's).
  private cacheWrite(changes: SealedChange[], scope?: { chat: string; cursor: number; complete: boolean }) {
    if (!this.cachedObjects.available || this.timeline === null) return;
    const scopes = scope ? [{ chat: scope.chat, state: this.cacheState(scope) }] : [...new Set(changes.filter((row) => SCOPED.has(row.kind)).map((row) => row.parent!))].flatMap((chat) => {
      const held = this.scopes.get(chat);
      return held?.state === 'loaded' && !held.loading ? [{ chat, state: this.cacheState({ cursor: held.cursor, complete: true }) }] : [];
    });
    this.cachedObjects.write({ changes, feed: this.cacheState(), scopes }, this.ended.signal);
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
    this.cachedObjects.clear(this.ended.signal);
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
    void this.cachedObjects.reload(() => this.load(epoch)).then(() => this.catchUp());
  }

  private adopt(timeline: string) {
    this.timeline = timeline;
    this.cachedObjects.adopt(timeline, this.ended.signal);
  }

  // Old-timeline writes are dropped, never replayed: every commit under way ends with the epoch, its unsent writes
  // counted. heard: the server or another tab said the account moved to another timeline, which the person is told.
  private reset(heard: boolean) {
    const dropped = this.pending.dropUnsent();
    const held = this.timeline !== null;
    this.timeline = null;
    this.epoch++;
    this.ended.abort();
    this.ended = new AbortController();
    for (const object of [...this.objects.values(), ...this.pending.values()]) this.changes.add({ kind: object.kind, id: object.id, parent: object.parent });
    this.pending.reset();
    for (const [chat, scope] of this.scopes) {
      scope.abort.abort();
      scope.abort = new AbortController();
      scope.state = 'unloaded';
      scope.cursor = scope.head = 0;
      scope.fold = this.chatFold(chat);
      scope.loading = scope.opening = null;
      this.behind.add(chat);
    }
    this.objects.clear();
    this.projections.reset();
    this.cursor = this.known = 0;
    this.bootstrap = null;
    this.bootstrapped = this.restored = false;
    this.limits = null;
    this.changes.publish();
    if (heard && (held || dropped)) for (const listener of this.rewoundListeners) listener(dropped);
  }

  private cacheBounds(known = this.known) {
    return this.cachedObjects.enabled ? `&known=${known}` : '';
  }

  readonly subscribe = this.changes.subscribe;
  readonly waiting = this.connection.waiting;

  // Writes shown or waiting their turn that the server has not taken yet: a page closed now loses them.
  readonly unsentWrites = this.pending.count;

  readonly subscribeWaiting = this.connection.subscribe;

  capture<T>(read: () => T): { value: T; reads: StoreRead[] } {
    return this.changes.capture(read);
  }

  get<K extends Kind>(kind: K, id: string): Stored<K> | null {
    this.changes.read({ kind, id });
    const held = this.pending.shown(id);
    const parent = this.pending.parent(id);
    if (SCOPED.has(kind) && (!parent || this.scopeState(parent) !== 'loaded')) throw new ScopeUnavailable(parent ?? null);
    return held && held.kind === kind && held.value !== undefined ? (held as Stored<K>) : null;
  }

  list<K extends Kind>(kind: K): Stored<K>[] {
    if (SCOPED.has(kind)) throw new ScopeUnavailable(null);
    this.changes.read({ kind, list: true });
    return this.pending.shownOf(this.objects.ids(kind), (held) => held.kind === kind);
  }

  children<K extends Kind>(kind: K, parent: string): Stored<K>[] {
    if (SCOPED.has(kind) && this.scopeState(parent) !== 'loaded') throw new ScopeUnavailable(parent);
    this.changes.read({ kind, parent });
    return this.pending.shownOf(this.objects.ids(kind, parent), (held) => held.kind === kind && held.parent === parent);
  }

  shownMark(chat: string): number {
    return this.pending.mark(chat);
  }

  private show(pending: Pending, commit: PendingCommit) {
    // As hold keeps them: a chat's entries and memory only while the chat is held, a walked kind's rows never.
    if (WALKED.has(pending.kind) || (SCOPED.has(pending.kind) && !(pending.parent && this.scopes.has(pending.parent)))) return;
    this.marked(commit.show(pending));
  }

  private unshow(id: string, commit: PendingCommit) {
    const overlay = commit.unshow(id);
    if (overlay) this.marked(overlay);
  }

  private marked(overlay: Overlay) {
    const { id, kind, parent } = overlay;
    if (!SCOPED.has(kind) || (parent && this.scopeState(parent) === 'loaded')) this.changes.add({ kind, id, parent });
    const chat = chatOf(overlay);
    if (!chat) return;
    if (kind === 'entry') this.scopes.get(chat)?.fold.changed(id);
  }

  close() {
    this.closing.abort();
    this.codec.close();
    this.evaluation.close();
    for (const scope of this.scopes.values()) scope.abort.abort();
    this.changes.close();
    this.rewoundListeners.clear();
    this.objects.clear();
    this.pending.close();
    this.projections.close();
    this.scopes.clear();
  }

  scopeState(chat: string): ScopeState {
    return this.scopes.get(chat)?.state ?? 'unloaded';
  }

  scopeError(chat: string): ApiFailure | null {
    return this.scopes.get(chat)?.error ?? null;
  }

  entryHead(chat: string): number {
    return this.objects.entryHead(chat);
  }

  loadedHead(chat: string): number {
    return this.scopes.get(chat)?.head ?? 0;
  }

  revision(read: StoreRead): number {
    return this.objects.revision(read);
  }

  private chatFold(chat: string) {
    return new ChatFold((id) => {
      const held = this.pending.shown(id);
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
      if (created) this.cacheWrite([], { chat, cursor: scope.cursor, complete: true });
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
    await this.cachedObjects.settled;
    const saved = await this.cachedObjects.read(chat, this.ended.signal);
    if (signal.aborted || this.scopes.get(chat) !== scope) return this.halted(epoch);
    if (saved) {
      scope.cursor = saved.state.cursor;
      const rows = saved.changes.sort((a, b) => a.rev - b.rev);
      const opened = this.opener(rows, true, signal);
      for (const [index, row] of rows.entries()) {
        await this.apply(row, () => opened(index), true, signal);
        if (signal.aborted) return this.halted(epoch);
        if (row.body && this.objects.get(row.id)?.value === undefined) {
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
      for (const id of [...(this.objects.ids(kind, chat) ?? [])]) this.objects.forget(id);
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

  // An explicit account/parent walk; it never fills the held chat scopes. Backup, ownership and ledger-fill walks run on
  // their workflow's pin (pinned). No row is visited once the pin's epoch has ended.
  async scan(options: { parent?: string; kind?: Kind; metadata?: boolean }, visit: (row: ObjectRow, value: unknown) => void | Promise<void>, pin: Pin, signal?: AbortSignal): Promise<ApiFailure | null> {
    const walked = await this.pages(options, 0, visit, pin, signal);
    return walked.ok ? null : walked;
  }

  // A walked kind's rows under parent (object-cache WALKED): from this device's cache, then from the server past the
  // cursor, each visited opened and cached. since: the cursor an earlier walk answered, from which only rows written
  // after it are read; 0 reads the cached rows first. Answers the cursor to walk on from.
  async walk(parent: string, kind: Kind, visit: (row: ObjectRow, value: unknown) => void, since: number, pin: Pin, signal?: AbortSignal): Promise<ApiResult<number>> {
    const stop = AbortSignal.any([this.closing.signal, this.ended.signal, ...(signal ? [signal] : [])]);
    let cursor = since;
    if (!cursor) {
      await this.cachedObjects.settled;
      const saved = await this.cachedObjects.read(parent, this.ended.signal);
      if (pin.epoch !== this.epoch || stop.aborted) return this.halted(pin.epoch);
      if (saved) {
        // An omitted row is the feed's, past the cursor, and read from the server below.
        const rows = saved.changes.filter((row) => row.kind === kind && row.body);
        const opened = this.opener(rows, true, stop, true);
        for (const [index, row] of rows.entries()) {
          let value: unknown;
          try {
            value = await opened(index);
          } catch (error) {
            return this.codecFailure(error, pin.epoch);
          }
          if (pin.epoch !== this.epoch || stop.aborted) return this.halted(pin.epoch);
          visit({ id: row.id, kind: row.kind, parent: row.parent, rev: row.rev }, upgradeValue(row.kind, value) ?? value);
        }
        cursor = saved.state.cursor;
      }
    }
    return this.pages({ parent, kind }, cursor, visit, pin, signal, (changes, at, more) => this.cacheWrite(changes, { chat: parent, cursor: at, complete: !more }));
  }

  private async pages(options: { parent?: string; kind?: Kind; metadata?: boolean }, since: number, visit: (row: ObjectRow, value: unknown) => void | Promise<void>, pin: Pin, signal?: AbortSignal, paged?: (changes: SealedChange[], cursor: number, more: boolean) => void): Promise<ApiResult<number>> {
    const stop = AbortSignal.any([this.closing.signal, this.ended.signal, ...(signal ? [signal] : [])]);
    let cursor = since;
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
      // A reset during the last visit: the page is of the old timeline and is never cached under the new one.
      if (pin.epoch !== this.epoch || stop.aborted) return this.halted(pin.epoch);
      cursor = result.data.cursor;
      more = result.data.more;
      paged?.(result.data.changes, cursor, more);
    }
    return { ok: true, data: cursor };
  }

  async removeRows(rows: ObjectRow[]): Promise<ApiResult<null>> {
    const removed = await this.commit(rows.map((row) => this.writes.remove(row)));
    return removed.ok ? { ok: true, data: null } : removed;
  }

  // The objects held in a shape upgraded as they were read (runtime/upgrade), each handed out once.
  takeUpgraded(): { id: string; kind: string }[] {
    const taken = [...this.upgraded].map(([id, kind]) => ({ id, kind }));
    this.upgraded.clear();
    return taken;
  }

  unreadable(): number {
    return this.objects.unreadable();
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
  // epoch fails too until the workflow has ended, so a workflow that can run long ends itself on timelineEnd.
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

  // Aborts once pin's epoch has ended.
  timelineEnd(pin: Pin): AbortSignal {
    return pin.epoch === this.epoch ? this.ended.signal : AbortSignal.abort();
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
    const { ordered, chats } = this.writes.arrange(writes, unheld);
    // Every touched chat stays held until its summary is written; entries held without a scope would never be let go.
    const leases = chats.map(({ chat, created }) => this.retainChat(chat, { created }));
    try {
      for (const lease of leases) {
        const failure = await lease.ready;
        if (failure) return failure;
      }
      const result = await this.commit(ordered.map((write) => this.writes.step(write)), (index) => progress(ordered[index]!), signal);
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
    return this.writeOne<K>(this.writes.step({ type: 'create', kind, id, parent, value }), SCOPED.has(kind) ? parent : null);
  }

  // The parent is the live object's, so an update never moves an object. One that is gone, or goes
  // while a conflict is resolved, fails as 'gone' and is never written back. So does a change that answers null: what
  // it changes is no longer there in the copy it is applied to, and nothing is written.
  update<K extends Exclude<Kind, AppendOnly>>(kind: K, id: string, change: (current: Values[K]) => Values[K] | null): Promise<ApiResult<Stored<K>>> {
    return this.writeOne<K>(this.writes.update(kind, id, change), SCOPED.has(kind) ? this.objects.get(id)?.parent ?? null : null);
  }

  // A singleton lives at the id its kind names, and current is undefined until it is first written.
  upsert<K extends Singleton>(kind: K, change: (current: Values[K] | undefined) => Values[K]): Promise<ApiResult<Stored<K>>> {
    return this.writeOne<K>(this.writes.upsert(kind, change), null);
  }

  // Writes a snapshot back (되돌리기, and a backup's objects): over the live object, or in place of a deleted
  // one at the rev its deletion took, under the parent it had.
  restore<K extends Kind>({ id, kind, parent, value }: Stored<K>): Promise<ApiResult<Stored<K>>> {
    return this.writeOne<K>(this.writes.step({ type: 'restore', id, kind, parent, value }), SCOPED.has(kind) ? parent : null);
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
  private async writeOne<K extends Kind>(step: WriteStep, chat: string | null): Promise<ApiResult<Stored<K>>> {
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

  // Do not inline into writeOne: this promise boundary orders completion against read-model updates.
  private async one<K extends Kind>(step: WriteStep): Promise<ApiResult<Stored<K>>> {
    const result = await this.commit([step]);
    return result.ok ? { ok: true, data: result.data[0] as Stored<K> } : result;
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
    return this.connection.run(attempt, stop);
  }

  private async commit(steps: WriteStep[], progress: (index: number) => void = () => {}, signal?: AbortSignal): Promise<ApiResult<(Held | null)[]>> {
    const stop = signal ? AbortSignal.any([this.closing.signal, signal]) : this.closing.signal;
    if (stop.aborted) return { ok: false, error: 'stopped' };
    const epoch = this.epoch;
    const saved: (Held | null)[] = [];
    const commit = this.pending.begin(steps.map((step) => step.id), () => steps.slice(saved.length).filter((step) => !step.derived).length);
    try {
      // Shown before the wait for an earlier write to the same object, applied to what reads show: the real resolve,
      // against live, runs inside send.
      for (const step of steps) {
        if (step.derived) continue;
        let preview: ApiResult<Resolved>;
        try { preview = step.resolve((id) => this.pending.shown(id)); } catch { continue; }
        if (preview.ok && preview.data.pending) this.show(preview.data.pending, commit);
      }
      if (commit.visible) {
        this.changes.publish();
        this.projections.refreshHeld();
      }
      if (commit.blocked) {
        if (!(await commit.wait(stop))) return { ok: false, error: 'stopped' };
        if (epoch !== this.epoch) return this.halted(epoch);
      }
      return await this.send(steps, saved, progress, stop, commit);
    } catch (error) {
      return this.codecFailure(error, epoch);
    } finally {
      commit.release();
      // A write that failed for good shows the confirmed copy again; its caller still gets the failure.
      if (commit.visible) {
        for (const overlay of commit.hide()) this.marked(overlay);
        this.changes.publish();
        this.projections.refreshHeld();
      }
    }
  }

  private async send(steps: WriteStep[], saved: (Held | null)[], progress: (index: number) => void, stop: AbortSignal, commit: PendingCommit): Promise<ApiResult<(Held | null)[]>> {
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
        const prepared = await this.writes.prepare(steps, { start, end, limits, timeline, signal: halt });
        if (!prepared.ok) return prepared;
        const { resolved, writes } = prepared.data;
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
          // A once write may answer the rev of a row already there with another body (a branch's copy of its original's
          // call): only the walk, which reads it from the server past its cursor, caches it.
          this.cacheWrite(writes.flatMap(({ id, kind, parent, body, once }, index) => (once ? [] : [{ id, kind, parent, body, rev: answer.data.revs[index]! }])));
        }
        for (let index = 0; index < resolved.length; index++) this.unshow(steps[start + index]!.id, commit);
        this.changes.publish();
        return { ok: true, data: resolved.map(({ held }) => held) };
      }, halt);
      if (!result.ok) return epoch === this.epoch ? result : this.halted(epoch);
      saved.push(...result.data);
      for (let index = start; index < saved.length; index++) progress(index);
    }
    this.projections.refreshHeld();
    return { ok: true, data: saved };
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
      const answer = this.reaching(() => this.request<Page>('GET', `objects?since=${since}&exclude=${[...UNFED].join(',')}${bootstrapped ? '' : `&bootstrap=1${this.bootstrap === null ? '' : `&until=${this.bootstrap}`}`}${count ? '&count=1' : ''}${this.cacheBounds(known)}${sent === null ? '' : `&timeline=${encodeURIComponent(sent)}`}`, undefined, signal), AbortSignal.any([signal, this.closing.signal, this.ended.signal]));
      return { epoch: this.epoch, sent, answer };
    };
    while (more) {
      if (this.cachedObjects.reloading) await this.cachedObjects.reloading;
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
          this.changes.publish();
          return { ok: false, error: 'stopped' };
        }
        if (epoch !== this.epoch) break;
        try {
          await this.apply(change, () => opened(index), false, stop);
        } catch (error) {
          if (error instanceof CodecAborted && epoch !== this.epoch) break;
          if (error instanceof CodecAborted) this.changes.publish();
          throw error;
        }
      }
      if (epoch !== this.epoch) continue;
      if (result.data.changes.length) this.changes.publish();
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
        if (change.body && SCOPED.has(change.kind) && this.objects.get(change.id)?.value === undefined) return { ok: false, error: 'unreadable' };
      }
      if (signal.aborted) return { ok: false, error: 'stopped' };
      scope.cursor = result.data.cursor;
      more = result.data.more;
      this.cacheWrite(result.data.changes, { chat, cursor: scope.cursor, complete: scope.state === 'loaded' || !more });
    }
    return null;
  }

  private opener(rows: SealedChange[], scoped: boolean, signal: AbortSignal, strict = false) {
    return this.codec.opener(rows, signal, { strict, accept: ({ id, kind, rev }) =>
      (scoped || !UNFED.has(kind)) && !this.objects.stale(id, rev),
    });
  }

  private async apply({ id, kind, parent, rev, body, omitted }: SealedChange, opened: () => Promise<unknown>, scoped: boolean, signal: AbortSignal) {
    if (signal?.aborted || this.closing.signal.aborted) return;
    this.recordRevision({ id, kind, parent, rev });
    if (scoped && kind === 'entry' && parent) {
      const scope = this.scopes.get(parent)!;
      scope.head = Math.max(scope.head, rev);
    }
    if (omitted || (UNFED.has(kind) && !scoped)) {
      if (!parent || this.scopeState(parent) !== 'loaded') this.changes.add({ id, kind, parent });
      // This device's own writes come back here too, and are already held.
      else if (!this.objects.stale(id, rev)) this.behind.add(parent);
      return;
    }
    if (this.objects.stale(id, rev)) return;
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
    if (this.closing.signal.aborted || this.objects.stale(object.id, object.rev)) return;
    if (WALKED.has(object.kind)) return this.changes.add({ kind: object.kind, id: object.id, parent: object.parent });
    // A chat's entries and memory stay in memory only while the chat is held.
    if (SCOPED.has(object.kind) && !(object.parent && this.scopes.has(object.parent))) return;
    const previous = this.objects.get(object.id);
    if (previous?.kind === 'entry' && previous.parent) this.scopes.get(previous.parent)?.fold.changed(object.id);
    if (object.kind === 'entry' && object.parent) this.scopes.get(object.parent)?.fold.changed(object.id);
    if (previous && (previous.kind !== object.kind || previous.parent !== object.parent)) this.changes.add({ kind: previous.kind, id: previous.id, parent: previous.parent });
    if (!SCOPED.has(object.kind) || (object.parent && this.scopeState(object.parent) === 'loaded')) this.changes.add({ kind: object.kind, id: object.id, parent: object.parent });
    this.objects.hold(object);
  }

  private drop(id: string, rev: number, change: StoreChange) {
    this.recordRevision({ ...change, rev });
    if (change.kind === 'entry' && change.parent) {
      const scope = this.scopes.get(change.parent);
      if (scope) scope.head = Math.max(scope.head, rev);
    }
    if (this.objects.stale(id, rev)) return;
    const previous = this.objects.get(id);
    if (change.kind === 'entry' && change.parent) this.scopes.get(change.parent)?.fold.changed(id);
    this.changes.add(previous ? { kind: previous.kind, id, parent: previous.parent } : change);
    this.objects.drop(id, rev);
  }

  private recordRevision(change: StoreChange & { rev: number }) {
    this.known = Math.max(this.known, change.rev);
    this.objects.recordRevision(change);
  }

  private scopeChanged(chat: string) {
    this.changes.add({ kind: 'scope', id: chat, parent: chat });
    this.changes.publish();
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
