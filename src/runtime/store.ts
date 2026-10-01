import { KINDS, type AppendOnly, type Kind, type Singleton, type Stored, type Values } from '../model/kinds';
import { objectKey, openObject, sealObject } from '../vault/objects';
import type { FileRef } from '../vault/files';
import type { VaultKey } from '../vault/keys';
import type { ApiFailure, ApiResult, api as realApi } from './api';
import { orderOwned } from './removal';

type Api = typeof realApi;
type Change = { id: string; kind: string; parent: string | null; rev: number; body: string | null };
export type StoreChange = { kind: string; id: string; parent: string | null };
export type StoreRead = { kind: Kind; id: string } | { kind: Kind; list: true } | { kind: Kind; parent: string };

export const readsChanged = (reads: StoreRead[], changes: readonly StoreChange[]) =>
  reads.some((read) => changes.some((change) => read.kind === change.kind && ('list' in read || ('id' in read ? read.id === change.id : read.parent === change.parent))));

type Limits = { items: number; bytes: number; body: number };
type Page = { changes: Change[]; cursor: number; more: boolean; limits: Limits };
type ObjectValue = Omit<Stored<Kind>, 'rev'>;
export type Write = (ObjectValue & { type: 'create' | 'restore' }) | { type: 'remove'; id: string };
type Pending = { id: string; kind: string; parent: string | null; value: unknown; baseRev: number | null };
type Resolved = { pending: Pending | null; held: Held | null };
type Step = { resolve: () => ApiResult<Resolved> };

// value is undefined for a body that did not open. Such an object is counted, never
// shown as if it were empty, and never overwritten. kind may be one a newer version wrote.
type Held = { id: string; kind: string; parent: string | null; rev: number; value: unknown };

const MAX_ATTEMPTS = 3;

// The browser's copy of the account's objects, decrypted in memory. The server stays the only source
// of truth: writes go to it first, and a version conflict is resolved by pulling the
// newer copy and applying the change again on top of it.
export class ObjectStore {
  private readonly live = new Map<string, Held>();
  private readonly deleted = new Map<string, number>();
  private readonly byKind = new Map<string, Set<string>>();
  private readonly byParent = new Map<string, Map<string, Set<string>>>();
  private unreadableCount = 0;
  private readonly listeners = new Set<(changes: readonly StoreChange[]) => void>();
  private readonly changes: StoreChange[] = [];
  private reading: StoreRead[] | null = null;
  private cursor = 0;
  private limits: Limits | null = null;
  private pulling: Promise<ApiFailure | null> | null = null;

  private constructor(
    private readonly accountId: string,
    private readonly key: CryptoKey,
    private readonly request: Api,
  ) {}

  static async open(accountId: string, vaultKey: VaultKey, request: Api): Promise<ObjectStore> {
    return new ObjectStore(accountId, await objectKey(vaultKey), request);
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
    return held && held.kind === kind && held.value !== undefined ? (held as Stored<K>) : null;
  }

  list<K extends Kind>(kind: K): Stored<K>[] {
    this.reading?.push({ kind, list: true });
    return [...(this.byKind.get(kind) ?? [])].map((id) => this.live.get(id)!).filter((held): held is Stored<K> => held.value !== undefined);
  }

  children<K extends Kind>(kind: K, parent: string): Stored<K>[] {
    this.reading?.push({ kind, parent });
    return [...(this.byParent.get(parent)?.get(kind) ?? [])].flatMap((id) => this.get(kind, id) ?? []);
  }

  unreadable(): number {
    return this.unreadableCount;
  }

  // One pull at a time: a caller arriving during a pull waits for that pull instead of starting another.
  pull(): Promise<ApiFailure | null> {
    this.pulling ??= this.pullPages().finally(() => (this.pulling = null));
    return this.pulling;
  }

  // One user action's writes, owned objects before their owners and in the order given within a kind, so an owner
  // appears only once whole and a chat's entries keep their rev order, which model/chat fold reads. An action
  // larger than one request goes as several, the owner in the last; one cut short leaves only unreachable pieces.
  async batch(writes: Write[], progress: (write: Write) => void = () => {}): Promise<ApiResult<null>> {
    const puts = orderOwned(writes.filter((write) => write.type !== 'remove'));
    const ordered = [...puts, ...writes.filter((write) => write.type === 'remove')];
    const result = await this.commit(ordered.map((write) => this.step(write)), (index) => progress(ordered[index]!));
    return result.ok ? { ok: true, data: null } : result;
  }

  // A create whose answer was lost after it landed finds its own object there when tried again, and
  // succeeds: a retried write with the same id is idempotent.
  create<K extends Exclude<Kind, Singleton>>(kind: K, value: Values[K], { id = crypto.randomUUID(), parent = null }: { id?: string; parent?: string | null } = {}): Promise<ApiResult<Stored<K>>> {
    return this.one<K>(this.step({ type: 'create', kind, id, parent, value }));
  }

  // The parent is the live object's, so an update never moves an object. One that is gone, or goes
  // while a conflict is resolved, fails as 'gone' and is never written back. So does a change that answers null: what
  // it changes is no longer there in the copy it is applied to, and nothing is written.
  update<K extends Exclude<Kind, AppendOnly>>(kind: K, id: string, change: (current: Values[K]) => Values[K] | null): Promise<ApiResult<Stored<K>>> {
    return this.one<K>({
      resolve: () => {
        const held = this.live.get(id);
        if (!held || held.kind !== kind) return { ok: false, error: 'gone' };
        if (held.value === undefined) return { ok: false, error: 'unreadable' };
        const value = change(held.value as Values[K]);
        if (value === null) return { ok: false, error: 'gone' };
        return { ok: true, data: { pending: { kind, id, parent: held.parent, value, baseRev: held.rev }, held: null } };
      },
    });
  }

  // A singleton lives at the id its kind names, and current is undefined until it is first written.
  upsert<K extends Singleton>(kind: K, change: (current: Values[K] | undefined) => Values[K]): Promise<ApiResult<Stored<K>>> {
    const id = KINDS[kind].id;
    return this.one<K>({
      resolve: () => {
        const held = this.live.get(id);
        if (held && held.value === undefined) return { ok: false, error: 'unreadable' };
        return { ok: true, data: { pending: { kind, id, parent: null, value: change(held?.value as Values[K] | undefined), baseRev: held?.rev ?? null }, held: null } };
      },
    });
  }

  // Writes a snapshot back (되돌리기, and a backup's objects): over the live object, or in place of a deleted
  // one at the rev its deletion took, under the parent it had.
  restore<K extends Kind>({ id, kind, parent, value }: Stored<K>): Promise<ApiResult<Stored<K>>> {
    return this.one<K>(this.step({ type: 'restore', id, kind, parent, value }));
  }

  async remove(id: string): Promise<ApiResult<null>> {
    const result = await this.commit([this.step({ type: 'remove', id })]);
    return result.ok ? { ok: true, data: null } : result;
  }

  // Answers the removed object, which restore (되돌리기) writes back.
  async take<K extends Kind>(kind: K, id: string): Promise<ApiResult<Stored<K>>> {
    const object = this.get(kind, id);
    if (!object) return { ok: false, error: 'gone' };
    const removed = await this.remove(id);
    return removed.ok ? { ok: true, data: object } : removed;
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
    if (!this.limits) {
      const failure = await this.pull();
      if (failure) return failure;
    }
    const limits = this.limits!;
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
          const answer = await this.request<{ revs: number[] }>('POST', 'objects/batch', { writes });
          if (!answer.ok) return answer;
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

  private async pullPages(): Promise<ApiFailure | null> {
    let more = true;
    while (more) {
      const result = await this.request<Page>('GET', `objects?since=${this.cursor}`);
      if (!result.ok) return result;
      this.limits = result.data.limits;
      for (const change of result.data.changes) await this.apply(change);
      this.cursor = result.data.cursor;
      more = result.data.more;
      if (result.data.changes.length) this.changed();
    }
    return null;
  }

  private async apply({ id, kind, parent, rev, body }: Change) {
    if (this.stale(id, rev)) return;
    if (body === null) return this.drop(id, rev, { kind, id, parent });
    this.hold({ id, kind, parent, rev, value: await openObject(this.key, this.accountId, { id, kind, parent }, body) });
  }

  private hold(object: Held) {
    if (this.stale(object.id, object.rev)) return;
    const previous = this.live.get(object.id);
    if (previous && (previous.kind !== object.kind || previous.parent !== object.parent)) this.changes.push({ kind: previous.kind, id: previous.id, parent: previous.parent });
    this.changes.push({ kind: object.kind, id: object.id, parent: object.parent });
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

export function keepSynced(store: ObjectStore): () => void {
  const pull = () => {
    if (document.visibilityState === 'visible') void store.pull();
  };
  const timer = setInterval(pull, 30_000);
  window.addEventListener('focus', pull);
  return () => {
    clearInterval(timer);
    window.removeEventListener('focus', pull);
  };
}
