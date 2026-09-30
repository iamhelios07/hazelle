import { KINDS, type AppendOnly, type Kind, type Singleton, type Stored, type Values } from '../model/kinds';
import { objectKey, openObject, sealObject } from '../vault/objects';
import type { VaultKey } from '../vault/keys';
import type { ApiFailure, ApiResult, api as realApi } from './api';

type Api = typeof realApi;
type Change = { id: string; kind: string; parent: string | null; rev: number; body: string | null };
type Page = { changes: Change[]; cursor: number; more: boolean };

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
  private readonly byParent = new Map<string, Set<string>>();
  private readonly listeners = new Set<() => void>();
  private cursor = 0;
  private pulling: Promise<ApiFailure | null> | null = null;
  private version = 0;

  private constructor(
    private readonly accountId: string,
    private readonly key: CryptoKey,
    private readonly request: Api,
  ) {}

  static async open(accountId: string, vaultKey: VaultKey, request: Api): Promise<ObjectStore> {
    return new ObjectStore(accountId, await objectKey(vaultKey), request);
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = () => this.version;

  get<K extends Kind>(kind: K, id: string): Stored<K> | null {
    const held = this.live.get(id);
    return held && held.kind === kind && held.value !== undefined ? (held as Stored<K>) : null;
  }

  list<K extends Kind>(kind: K): Stored<K>[] {
    return [...this.live.values()].filter((held): held is Stored<K> => held.kind === kind && held.value !== undefined);
  }

  children<K extends Kind>(kind: K, parent: string): Stored<K>[] {
    return [...(this.byParent.get(parent) ?? [])].flatMap((id) => this.get(kind, id) ?? []);
  }

  unreadable(): number {
    return [...this.live.values()].filter((held) => held.value === undefined).length;
  }

  // One pull at a time: a caller arriving during a pull waits for that pull instead of starting another.
  pull(): Promise<ApiFailure | null> {
    this.pulling ??= this.pullPages().finally(() => (this.pulling = null));
    return this.pulling;
  }

  // A create whose answer was lost after it landed finds its own object there when tried again, and
  // succeeds: a retried write with the same id is idempotent.
  async create<K extends Exclude<Kind, Singleton>>(kind: K, value: Values[K], { id = crypto.randomUUID(), parent = null }: { id?: string; parent?: string | null } = {}): Promise<ApiResult<Stored<K>>> {
    if (!this.fits(kind, parent)) return { ok: false, error: 'bad-input' };
    return this.retry(() => {
      const held = this.live.get(id);
      if (!held) return this.write(kind, id, parent, value, null);
      const landed = held.kind === kind && held.parent === parent && JSON.stringify(held.value) === JSON.stringify(value);
      return landed ? { ok: true, data: held as Stored<K> } : { ok: false, error: 'conflict' };
    });
  }

  // The parent is the live object's, so an update never moves an object. One that is gone, or goes
  // while a conflict is resolved, fails as 'gone' and is never written back.
  update<K extends Exclude<Kind, AppendOnly>>(kind: K, id: string, change: (current: Values[K]) => Values[K]): Promise<ApiResult<Stored<K>>> {
    return this.retry(() => {
      const held = this.live.get(id);
      if (!held || held.kind !== kind) return { ok: false, error: 'gone' };
      if (held.value === undefined) return { ok: false, error: 'unreadable' };
      return this.write(kind, id, held.parent, change(held.value as Values[K]), held.rev);
    });
  }

  // A singleton lives at the id its kind names, and current is undefined until it is first written.
  upsert<K extends Singleton>(kind: K, change: (current: Values[K] | undefined) => Values[K]): Promise<ApiResult<Stored<K>>> {
    const id = KINDS[kind].id;
    return this.retry(() => {
      const held = this.live.get(id);
      if (held && held.value === undefined) return { ok: false, error: 'unreadable' };
      return this.write(kind, id, null, change(held?.value as Values[K] | undefined), held?.rev ?? null);
    });
  }

  // Writes a snapshot back (되돌리기, and a backup's objects): over the live object, or in place of a deleted
  // one at the rev its deletion took, under the parent it had.
  restore<K extends Kind>({ id, kind, parent, value }: Stored<K>): Promise<ApiResult<Stored<K>>> {
    return this.retry(() => {
      const held = this.live.get(id);
      if (held && held.value === undefined) return { ok: false, error: 'unreadable' };
      return this.write(kind, id, parent, value, held?.rev ?? this.deleted.get(id) ?? null);
    });
  }

  remove(id: string): Promise<ApiResult<null>> {
    return this.retry(async () => {
      const held = this.live.get(id);
      if (!held) return { ok: true, data: null };
      const result = await this.request<{ rev: number }>('DELETE', `objects/${id}`, { kind: held.kind, baseRev: held.rev });
      if (!result.ok) return result;
      this.drop(id, result.data.rev);
      this.changed();
      return { ok: true, data: null };
    });
  }

  // Answers the removed object, which restore (되돌리기) writes back.
  async take<K extends Kind>(kind: K, id: string): Promise<ApiResult<Stored<K>>> {
    const object = this.get(kind, id);
    if (!object) return { ok: false, error: 'gone' };
    const removed = await this.remove(id);
    return removed.ok ? { ok: true, data: object } : removed;
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

  private async write<K extends Kind>(kind: K, id: string, parent: string | null, value: Values[K], baseRev: number | null): Promise<ApiResult<Stored<K>>> {
    const address = { id, kind, parent };
    const result = await this.request<{ rev: number }>('PUT', `objects/${id}`, { kind, parent, body: await sealObject(this.key, this.accountId, address, value), baseRev });
    if (!result.ok) return result;
    const stored = { ...address, rev: result.data.rev, value };
    this.hold(stored);
    this.changed();
    return { ok: true, data: stored };
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
      for (const change of result.data.changes) await this.apply(change);
      this.cursor = result.data.cursor;
      more = result.data.more;
      if (result.data.changes.length) this.changed();
    }
    return null;
  }

  private async apply({ id, kind, parent, rev, body }: Change) {
    if (body === null) return this.drop(id, rev);
    this.hold({ id, kind, parent, rev, value: await openObject(this.key, this.accountId, { id, kind, parent }, body) });
  }

  private hold(object: Held) {
    if (this.stale(object.id, object.rev)) return;
    this.forget(object.id);
    this.deleted.delete(object.id);
    this.live.set(object.id, object);
    if (object.parent === null) return;
    const siblings = this.byParent.get(object.parent);
    if (siblings) siblings.add(object.id);
    else this.byParent.set(object.parent, new Set([object.id]));
  }

  private drop(id: string, rev: number) {
    if (this.stale(id, rev)) return;
    this.forget(id);
    this.deleted.set(id, rev);
  }

  // Every write takes the account's next rev, so one not above the rev held for the id is that write or an older
  // one arriving late. Checked here, after apply's await: a write can land while a pulled body decrypts.
  private stale(id: string, rev: number): boolean {
    const known = this.live.get(id)?.rev ?? this.deleted.get(id);
    return known !== undefined && rev <= known;
  }

  private forget(id: string) {
    const held = this.live.get(id);
    if (held?.parent) this.byParent.get(held.parent)?.delete(id);
    this.live.delete(id);
  }

  private changed() {
    this.version++;
    for (const listener of this.listeners) listener();
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
