import { objectKey, openObject, sealObject } from '../vault/objects';
import type { VaultKey } from '../vault/keys';
import type { ApiFailure, ApiResult, api as realApi } from './api';

type Api = typeof realApi;
type Change = { id: string; kind: string; parent: string | null; rev: number; body: string | null };
type Page = { changes: Change[]; cursor: number; more: boolean };

export type Stored<T> = { id: string; kind: string; parent: string | null; rev: number; value: T };

// value is undefined for a body that did not open (objects.ts). Such an object is counted, never
// shown as if it were empty, and never overwritten.
type Entry = Omit<Stored<unknown>, 'value'> & { value: unknown };

const MAX_ATTEMPTS = 3;

// The browser's copy of the account's objects, decrypted in memory. The server stays the only source
// of truth (design §3): writes go to it first, and a version conflict is resolved by pulling the
// newer copy and applying the change again on top of it.
export class ObjectStore {
  private readonly live = new Map<string, Entry>();
  private readonly deleted = new Map<string, number>();
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

  list<T>(kind: string): Stored<T>[] {
    return [...this.live.values()].filter((entry) => entry.kind === kind && entry.value !== undefined) as Stored<T>[];
  }

  get<T>(id: string): Stored<T> | null {
    const entry = this.live.get(id);
    return entry && entry.value !== undefined ? (entry as Stored<T>) : null;
  }

  unreadable(): number {
    return [...this.live.values()].filter((entry) => entry.value === undefined).length;
  }

  // One pull at a time: a caller arriving during a pull waits for that pull instead of starting another.
  pull(): Promise<ApiFailure | null> {
    this.pulling ??= this.pullPages().finally(() => (this.pulling = null));
    return this.pulling;
  }

  // Creates the object when it does not exist yet, including one that was deleted: writing a deleted
  // object again restores it.
  async save<T>(kind: string, id: string, change: (current: T | undefined) => T, parent: string | null = null): Promise<ApiResult<Stored<T>>> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const current = this.live.get(id);
      if (current && current.value === undefined) return { ok: false, error: 'unreadable' };
      const value = change(current?.value as T | undefined);
      const address = { id, kind, parent };
      const result = await this.request<{ rev: number }>('PUT', `objects/${id}`, {
        kind,
        parent,
        body: await sealObject(this.key, this.accountId, address, value),
        baseRev: current?.rev ?? this.deleted.get(id) ?? null,
      });
      if (result.ok) {
        const stored = { ...address, rev: result.data.rev, value };
        this.deleted.delete(id);
        this.live.set(id, stored);
        this.changed();
        return { ok: true, data: stored };
      }
      if (result.error !== 'conflict') return result;
      const failure = await this.pull();
      if (failure) return failure;
    }
    return { ok: false, error: 'conflict' };
  }

  async remove(id: string): Promise<ApiResult<null>> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const current = this.live.get(id);
      if (!current) return { ok: true, data: null };
      const result = await this.request<{ rev: number }>('DELETE', `objects/${id}`, { kind: current.kind, baseRev: current.rev });
      if (result.ok) {
        this.live.delete(id);
        this.deleted.set(id, result.data.rev);
        this.changed();
        return { ok: true, data: null };
      }
      if (result.error !== 'conflict') return result;
      const failure = await this.pull();
      if (failure) return failure;
    }
    return { ok: false, error: 'conflict' };
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
    if (body === null) {
      this.live.delete(id);
      this.deleted.set(id, rev);
      return;
    }
    this.deleted.delete(id);
    this.live.set(id, { id, kind, parent, rev, value: await openObject(this.key, this.accountId, { id, kind, parent }, body) });
  }

  private changed() {
    this.version++;
    for (const listener of this.listeners) listener();
  }
}

// tech-spec §5: pull when the window regains focus, and every 30 s while the tab is visible.
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
