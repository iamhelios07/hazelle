import { KINDS, type AppendOnly, type Kind, type Singleton, type Stored, type Values } from '../model/kinds';
import { objectKey, openObject, sealObject } from '../vault/objects';
import type { FileRef } from '../vault/files';
import type { VaultKey } from '../vault/keys';
import type { ApiFailure, ApiResult, api as realApi } from './api';
import { orderOwned } from './removal';
import { SCOPED, type CacheState, type CacheWrite, type DeviceCache, type SealedChange } from './object-cache';
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
type Page = { until?: number; changes: SealedChange[]; cursor: number; more: boolean; limits: Limits };
type ObjectValue = Omit<Stored<Kind>, 'rev'>;
export type Write = (ObjectValue & { type: 'create' | 'restore' }) | { type: 'remove'; id: string };
type Pending = { id: string; kind: string; parent: string | null; value: unknown; baseRev: number | null };
type Resolved = { pending: Pending | null; held: Held | null };
type Step = { resolve: () => ApiResult<Resolved> };

// value is undefined for a body that did not open. Such an object is counted, never
// shown as if it were empty, and never overwritten. kind may be one a newer version wrote.
type Held = { id: string; kind: string; parent: string | null; rev: number; value: unknown };

const MAX_ATTEMPTS = 3;
const OPEN_AHEAD = 256;
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
  private readonly changes: StoreChange[] = [];
  private reading: StoreRead[] | null = null;
  private cursor = 0;
  private bootstrap: number | null = null;
  private bootstrapped = false;
  private readonly scopes = new Map<string, Scope>();
  private readonly heads = new Map<string, number>();
  private readonly revisions = new Map<string, number>();
  private readonly projections = new Map<string, Projection>();
  private readonly summarizing = new Map<string, Promise<ApiFailure | null>>();
  private readonly behind = new Set<string>();
  private limits: Limits | null = null;
  private pulling: Promise<ApiFailure | null> | null = null;
  private caching: Promise<void> = Promise.resolve();
  private cacheFailed = false;
  private epoch = 0;
  private known = 0;
  private restored = false;

  private constructor(
    private readonly accountId: string,
    private readonly key: CryptoKey,
    private readonly request: Api,
    private readonly cache?: DeviceCache,
  ) {}

  static async open(accountId: string, vaultKey: VaultKey, request: Api, cache?: DeviceCache, signal?: AbortSignal): Promise<ObjectStore> {
    const store = new ObjectStore(accountId, await objectKey(vaultKey), request, cache);
    try {
      const saved = await cache?.read();
      if (saved) {
        const { state } = saved;
        store.cursor = state.cursor;
        store.bootstrap = state.until;
        store.bootstrapped = state.complete;
        store.limits = state.limits;
        for (const [chat, head] of state.heads) store.heads.set(chat, head);
        for (const [read, rev] of state.revisions) store.revisions.set(read, rev);
        store.known = Math.max(state.cursor, state.until ?? 0);
        for (const [, rev] of [...state.heads, ...state.revisions]) store.known = Math.max(store.known, rev);
        const rows = saved.changes.sort((a, b) => a.rev - b.rev);
        const opened = store.opener(rows, false);
        for (const [index, row] of rows.entries()) {
          if (signal?.aborted) return store;
          await store.apply(row, false, undefined, opened(index));
        }
        store.changes.length = 0;
        store.restored = true;
      }
    } catch {
      store.reset();
    }
    return store;
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
    if (!this.cache || this.cacheFailed) return;
    const scopes = chat && scope ? [{ chat, state: { ...this.cacheState(scope), complete } }] : [...new Set(changes.filter((row) => SCOPED.has(row.kind)).map((row) => row.parent!))].flatMap((chat) => {
      const held = this.scopes.get(chat);
      return held?.state === 'loaded' && !held.loading ? [{ chat, state: this.cacheState(held) }] : [];
    });
    const write: CacheWrite = { changes, feed: this.cacheState(), scopes };
    this.queueCache(() => this.cache!.write(write));
  }

  // A failed transaction leaves a valid prefix. Never advance a later cursor past rows it failed to save.
  private queueCache(write: () => Promise<void>) {
    this.caching = this.caching.then(async () => {
      if (!this.cacheFailed) await write();
    }).catch(() => { this.cacheFailed = true; });
  }

  private reset() {
    this.epoch++;
    for (const object of this.live.values()) this.changes.push({ kind: object.kind, id: object.id, parent: object.parent });
    for (const [chat, scope] of this.scopes) {
      scope.abort.abort();
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
    this.unreadableCount = this.cursor = this.known = 0;
    this.bootstrap = null;
    this.bootstrapped = this.restored = false;
    this.limits = null;
    if (this.cache) this.caching = this.caching.then(() => this.cache!.clear()).catch(() => { this.cacheFailed = true; });
    this.changed();
  }

  private cacheBounds() {
    return this.cache ? `&account=${encodeURIComponent(this.accountId)}&known=${this.known}` : '';
  }

  readonly subscribe = (listener: (changes: readonly StoreChange[]) => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
    for (const scope of this.scopes.values()) scope.abort.abort();
    this.listeners.clear();
    this.live.clear();
    this.byKind.clear();
    this.byParent.clear();
    this.projections.clear();
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
    if (this.scopeState(chat) !== 'loaded') return null;
    const previous = this.projections.get(chat);
    if (this.scopes.get(chat)?.loading && previous) return previous;
    if (previous && !summaryStale(this, chat, previous.summary, this.loadedHead(chat))) return previous;
    const next = projectChat(this, chat, previous);
    if (next) this.projections.set(chat, next);
    else this.projections.delete(chat);
    return next;
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
      const opening = this.openChat(chat, held).finally(() => { if (held.opening === opening) held.opening = null; });
      held.opening = opening;
    }
    const ready = held.opening ?? Promise.resolve(null);
    let released = false;
    return { ready, release: () => {
      if (released) return;
      released = true;
      held.users--;
      if (!held.users) this.releaseChat(chat, held);
    } };
  }

  private async openChat(chat: string, scope: Scope): Promise<ApiFailure | null> {
    const signal = scope.abort.signal;
    scope.state = 'loading';
    this.changes.push({ kind: 'scope', id: chat, parent: chat });
    this.changed();
    await this.caching;
    const saved = this.cacheFailed ? null : await this.cache?.read(chat).catch(() => null);
    if (signal.aborted || this.scopes.get(chat) !== scope) return { ok: false, error: 'stopped' };
    if (saved) {
      scope.cursor = saved.state.cursor;
      const rows = saved.changes.sort((a, b) => a.rev - b.rev);
      const opened = this.opener(rows, true);
      for (const [index, row] of rows.entries()) {
        await this.apply(row, true, signal, opened(index));
        if (signal.aborted) return { ok: false, error: 'stopped' };
        if (row.body && this.live.get(row.id)?.value === undefined) {
          scope.state = 'failed';
          scope.error = { ok: false, error: 'unreadable' };
          this.changes.push({ kind: 'scope', id: chat, parent: chat });
          this.changed();
          return scope.error;
        }
      }
      if (signal.aborted) return { ok: false, error: 'stopped' };
      if (saved.state.complete && !saved.changes.some((row) => row.omitted)) {
        scope.state = 'loaded';
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

  async withChat<T>(chat: string, run: () => Promise<ApiResult<T>>): Promise<ApiResult<T>> {
    const lease = this.retainChat(chat);
    try {
      const failure = await lease.ready;
      return failure ?? await run();
    } finally { lease.release(); }
  }

  refreshChat(chat: string): Promise<ApiFailure | null> {
    const scope = this.scopes.get(chat);
    if (!scope) throw new ScopeUnavailable(chat);
    if (scope.loading) return scope.loading;
    if (scope.state !== 'loaded') scope.state = 'loading';
    scope.error = null;
    const abort = new AbortController();
    scope.abort = abort;
    scope.loading = this.pullParent(chat, scope, abort.signal).then((failure) => {
      if (abort.signal.aborted || this.scopes.get(chat) !== scope) return { ok: false, error: 'stopped' } as const;
      scope.error = failure;
      scope.state = failure && (scope.state !== 'loaded' || failure.error === 'unreadable') ? 'failed' : 'loaded';
      scope.loading = null;
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
    const save = async (): Promise<ApiFailure | null> => {
      for (;;) {
        if (this.loadedHead(chat) < this.entryHead(chat)) {
          const failed = await this.refreshChat(chat);
          if (failed) return failed;
        }
        const write = this.summaryWrite(chat);
        if (!write) return null;
        const result = await this.commit([this.step(write)]);
        if (!result.ok) return result;
      }
    };
    const saving = save().finally(() => this.summarizing.delete(chat));
    this.summarizing.set(chat, saving);
    return saving;
  }

  private summaryWrite(chat: string): Write | null {
    const projection = this.projection(chat);
    if (!projection) return null;
    const id = summaryId(chat);
    const current = this.get('summary', id);
    if (current && !summaryStale(this, chat, current.value) && current.value.title === projection.summary.title && current.value.preview === projection.summary.preview) return null;
    // The projection's source versions travel with it. A concurrent edit can never make an old summary look current.
    return { type: 'restore', id, kind: 'summary', parent: chat, value: projection.summary };
  }

  // An explicit account/parent walk for backup and ownership operations; it never fills the held chat scopes.
  async scan(options: { parent?: string; metadata?: boolean }, visit: (row: ObjectRow, value: unknown) => void): Promise<ApiFailure | null> {
    let cursor = 0;
    let more = true;
    while (more) {
      const result = await this.request<Page>('GET', `objects?since=${cursor}${options.parent ? `&parent=${encodeURIComponent(options.parent)}` : ''}${options.metadata ? '&metadata=1' : ''}`, undefined, this.closing.signal);
      if (!result.ok) return result;
      this.limits = result.data.limits;
      for (const { body, omitted, ...row } of result.data.changes) {
        if (body === null) continue;
        const value = omitted ? undefined : await openObject(this.key, this.accountId, row, body!);
        visit(row, value);
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

  // One pull at a time: a caller arriving during a pull waits for that pull instead of starting another.
  // The caller starting it owns its signal and progress.
  pull(options: PullOptions = {}): Promise<ApiFailure | null> {
    this.pulling ??= this.pullPages(options).finally(() => (this.pulling = null));
    return this.pulling;
  }

  // One user action's writes, owned objects before their owners and in the order given within a kind, so an owner
  // appears only once whole and a chat's entries keep their rev order, which model/chat fold reads. An action
  // larger than one request goes as several, the owner in the last; one cut short leaves only unreachable pieces.
  async batch(writes: Write[], progress: (write: Write) => void = () => {}): Promise<ApiResult<null>> {
    const puts = orderOwned(writes.filter((write) => write.type !== 'remove'));
    const ordered = [...puts, ...writes.filter((write) => write.type === 'remove')];
    const chats = new Set<string>();
    const created = new Set<string>();
    for (const write of ordered) {
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
      const result = await this.commit(ordered.map((write) => this.step(write)), (index) => progress(ordered[index]!));
      if (!result.ok) return result;
      const summaries = await this.commit([...chats].flatMap((chat) => this.summaryWrite(chat) ?? []).map((write) => this.step(write)));
      if (!summaries.ok) return summaries;
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

  private async retry<T>(attempt: () => ApiResult<T> | Promise<ApiResult<T>>): Promise<ApiResult<T>> {
    for (let tries = 0; tries < MAX_ATTEMPTS; tries++) {
      const result = await attempt();
      if (result.ok || result.error !== 'conflict') return result;
      const failure = await this.pull();
      if (failure) return failure;
    }
    return { ok: false, error: 'conflict' };
  }

  private async commit(steps: Step[], progress: (index: number) => void = () => {}): Promise<ApiResult<(Held | null)[]>> {
    if (this.closing.signal.aborted) return { ok: false, error: 'stopped' };
    if (!this.limits) {
      const failure = await this.pull();
      if (failure) return failure;
    }
    const limits = this.limits!;
    const epoch = this.epoch;
    const saved: (Held | null)[] = [];
    while (saved.length < steps.length) {
      const start = saved.length;
      const result = await this.retry(async (): Promise<ApiResult<(Held | null)[]>> => {
        const resolved: Resolved[] = [];
        const writes: { id: string; kind: string; parent: string | null; baseRev: number | null; body: string | null; file: string | null }[] = [];
        let bytes = new TextEncoder().encode(JSON.stringify({ writes: [] })).length;
        for (const step of steps.slice(start, start + limits.items)) {
          const ready = step.resolve();
          if (!ready.ok) return ready;
          const { pending } = ready.data;
          if (pending) {
            const { id, kind, parent, baseRev, value } = pending;
            const body = value === undefined ? null : await sealObject(this.key, this.accountId, { id, kind, parent }, value);
            if (body !== null && body.length > limits.body) return { ok: false, error: 'too-large' };
            // The server is told which stored file the object names; the file itself went up before (runtime/files).
            const file = body !== null && 'file' in KINDS[kind as Kind] ? (value as { file: FileRef }).file.id : null;
            const write = { id, kind, parent, baseRev, body, file };
            const size = new TextEncoder().encode(JSON.stringify(write)).length + (writes.length ? 1 : 0);
            if (bytes + size > limits.bytes) {
              if (!resolved.length) return { ok: false, error: 'too-large' };
              break;
            }
            bytes += size;
            writes.push(write);
          }
          resolved.push(ready.data);
        }
        if (writes.length) {
          if (epoch !== this.epoch || this.closing.signal.aborted) return { ok: false, error: 'stopped' };
          const answer = await this.request<{ revs: number[] }>('POST', 'objects/batch', { writes }, this.closing.signal);
          if (!answer.ok) return answer;
          if (epoch !== this.epoch || this.closing.signal.aborted) return { ok: false, error: 'stopped' };
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
      });
      if (!result.ok) return result;
      saved.push(...result.data);
      for (let index = start; index < saved.length; index++) progress(index);
    }
    return { ok: true, data: saved };
  }

  // A parent this store has not seen passes: addCharacter writes a character's lore and avatar before
  // the character itself.
  private fits(kind: Kind, parent: string | null): boolean {
    const rule = KINDS[kind].parent;
    if (rule === null || parent === null) return rule === parent;
    const held = this.live.get(parent);
    return !held || held.kind === rule;
  }

  private async pullPages({ signal = this.closing.signal, progress }: PullOptions): Promise<ApiFailure | null> {
    let more = true;
    let objects = 0;
    let pages = 0;
    while (more) {
      if (signal?.aborted) return { ok: false, error: 'stopped' };
      const epoch = this.epoch;
      const result = await this.request<Page>('GET', `objects?since=${this.cursor}&exclude=entry,memory${this.bootstrapped ? '' : `&bootstrap=1${this.bootstrap === null ? '' : `&until=${this.bootstrap}`}`}${this.cacheBounds()}`, undefined, signal);
      if (signal?.aborted) return { ok: false, error: 'stopped' };
      if (epoch !== this.epoch) continue;
      if (!result.ok) {
        if (result.error === 'cache-reset' || result.error === 'account-mismatch') {
          this.reset();
          if (result.error === 'cache-reset') continue;
        }
        return result;
      }
      objects += result.data.changes.length;
      progress?.({ objects, pages: ++pages });
      this.limits = result.data.limits;
      this.bootstrap ??= result.data.until ?? null;
      const opened = this.opener(result.data.changes, false);
      for (const [index, change] of result.data.changes.entries()) {
        if (signal?.aborted) {
          this.changed();
          return { ok: false, error: 'stopped' };
        }
        if (epoch !== this.epoch) break;
        await this.apply(change, false, undefined, opened(index));
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
      if (!this.scopes.has(chat)) continue;
      const failure = await this.refreshChat(chat);
      if (failure) return failure;
    }
    return signal?.aborted ? { ok: false, error: 'stopped' } : null;
  }

  private async pullParent(chat: string, scope: Scope, signal: AbortSignal): Promise<ApiFailure | null> {
    if (!this.bootstrapped) {
      const failure = await this.pull();
      if (failure) return failure;
    }
    let more = true;
    while (more) {
      const result = await this.request<Page>('GET', `objects?since=${scope.cursor}&parent=${encodeURIComponent(chat)}${this.cacheBounds()}`, undefined, signal);
      if (!result.ok) {
        if (result.error === 'cache-reset' || result.error === 'account-mismatch') {
          this.reset();
          if (result.error === 'cache-reset') void (this.pulling ?? Promise.resolve()).then(() => {
            if (!this.closing.signal.aborted && !this.bootstrapped) void this.pull();
          });
        }
        return result;
      }
      if (signal.aborted) return { ok: false, error: 'stopped' };
      this.limits = result.data.limits;
      const opened = this.opener(result.data.changes, true);
      for (const [index, change] of result.data.changes.entries()) {
        if (signal.aborted) return { ok: false, error: 'stopped' };
        await this.apply(change, true, signal, opened(index));
        if (change.body && SCOPED.has(change.kind) && this.live.get(change.id)?.value === undefined) return { ok: false, error: 'unreadable' };
      }
      if (signal.aborted) return { ok: false, error: 'stopped' };
      scope.cursor = result.data.cursor;
      more = result.data.more;
      this.cacheWrite(result.data.changes, chat, scope, scope.state === 'loaded' || !more);
    }
    return null;
  }

  // Bodies open ahead of the row being applied, so decryption and inflation overlap; rows still apply in rev order. A body
  // that throws while opening counts as unreadable, as one that fails authentication does.
  private opener(rows: SealedChange[], scoped: boolean): (index: number) => Promise<unknown> | undefined {
    const opened = new Map<number, Promise<unknown>>();
    let next = 0;
    return (index) => {
      for (; next < Math.min(rows.length, index + OPEN_AHEAD); next++) {
        const { id, kind, parent, rev, body, omitted } = rows[next]!;
        if (typeof body !== 'string' || omitted || (SCOPED.has(kind) && !scoped) || this.stale(id, rev)) continue;
        opened.set(next, openObject(this.key, this.accountId, { id, kind, parent }, body).catch(() => undefined));
      }
      const open = opened.get(index);
      opened.delete(index);
      return open;
    };
  }

  private async apply({ id, kind, parent, rev, body, omitted }: SealedChange, scoped = false, signal?: AbortSignal, opened?: Promise<unknown>) {
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
    const value = await (opened ?? openObject(this.key, this.accountId, { id, kind, parent }, body!));
    if (!signal?.aborted && epoch === this.epoch) this.hold({ id, kind, parent, rev, value });
  }

  private hold(object: Held) {
    this.recordRevision(object);
    if (object.kind === 'entry' && object.parent) {
      const scope = this.scopes.get(object.parent);
      if (scope) scope.head = Math.max(scope.head, object.rev);
    }
    if (this.closing.signal.aborted || this.stale(object.id, object.rev)) return;
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
