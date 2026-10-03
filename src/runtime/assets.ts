import type { Files } from './files';
import type { ObjectStore } from './store';

const PERMANENT = new Set(['not-found', 'unreadable']);
const INACTIVE_BYTES = 32 * 1024 * 1024;
type Cached = { url: string | null; bytes: number; owners: Set<string>; removed: boolean };
export type AssetView = { url: (id: string) => string | undefined; hold: () => () => void };

// Mounted views pin their pictures. Only inactive URLs compete for the byte-bounded LRU; a large currently visible
// picture must never disappear just because another picture was read. The session still owns final cleanup.
export class AssetUrls {
  // Null while reading, and for a permanent failure. A transient failure is forgotten so the next draw retries it.
  private readonly urls = new Map<string, Cached>();
  private readonly sources = new Map<string, string>();
  private readonly pins = new Map<string, number>();
  private readonly inactive = new Map<string, Cached>();
  private inactiveBytes = 0;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private version = 0;
  private closed = false;

  constructor(
    private readonly store: Pick<ObjectStore, 'get' | 'subscribe'>,
    private readonly files: Pick<Files, 'read'>,
    private readonly budget = INACTIVE_BYTES,
  ) {
    this.unsubscribe = store.subscribe((changes) => {
      let changed = false;
      for (const { kind, id } of changes) {
        if (kind !== 'asset') continue;
        const file = this.sources.get(id);
        if (!file || store.get('asset', id)?.value.file.id === file) continue;
        this.sources.delete(id);
        const cached = this.urls.get(file)!;
        cached.owners.delete(id);
        if (!cached.owners.size) {
          cached.removed = true;
          // Removal invalidates new lookups immediately, but a mounted view keeps its old URL until it leaves.
          if (!this.pins.has(file)) this.evict(file, cached);
        }
        changed = true;
      }
      if (changed) this.changed();
    });
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = () => this.version;

  // Creating a view during render holds nothing. Its committed mount activates all files resolved so far, and its
  // cleanup releases them. Re-activation is intentional: React's strict effects replay the same view's mount.
  view(): AssetView {
    const files = new Set<string>();
    let held = false;
    return {
      url: (id) => this.lookup(id, (file) => {
        if (files.has(file)) return;
        files.add(file);
        if (held) this.pin(file);
      }),
      hold: () => {
        if (!held && !this.closed) {
          held = true;
          for (const file of files) this.pin(file);
        }
        return () => {
          if (!held) return;
          held = false;
          for (const file of files) this.release(file);
        };
      },
    };
  }

  private lookup(id: string, named: (file: string) => void): string | undefined {
    if (this.closed) return undefined;
    const asset = this.store.get('asset', id)?.value;
    if (!asset) return undefined;
    const { file, type } = asset;
    named(file.id);
    let cached = this.urls.get(file.id);
    if (!cached) {
      cached = { url: null, bytes: 0, owners: new Set(), removed: false };
      this.urls.set(file.id, cached);
      const loading = cached;
      void this.files.read(file).then((read) => {
        if (this.closed || this.urls.get(file.id) !== loading) return;
        if (!read.ok) {
          if (!PERMANENT.has(read.error)) this.evict(file.id, loading);
          return;
        }
        loading.url = URL.createObjectURL(new Blob([read.data], { type }));
        loading.bytes = read.data.byteLength;
        if (!this.pins.has(file.id)) this.rest(file.id, loading);
        this.changed();
      });
    }
    cached.removed = false;
    cached.owners.add(id);
    this.sources.set(id, file.id);
    if (this.inactive.delete(file.id)) this.inactive.set(file.id, cached);
    return cached.url ?? undefined;
  }

  private pin(file: string) {
    const count = this.pins.get(file) ?? 0;
    this.pins.set(file, count + 1);
    if (count === 0) this.wake(file);
  }

  private release(file: string) {
    const count = this.pins.get(file);
    if (count === undefined) return;
    if (count > 1) return void this.pins.set(file, count - 1);
    this.pins.delete(file);
    const cached = this.urls.get(file);
    if (cached) this.rest(file, cached);
  }

  private wake(file: string) {
    const cached = this.inactive.get(file);
    if (!cached) return;
    this.inactiveBytes -= cached.bytes;
    this.inactive.delete(file);
  }

  private rest(file: string, cached: Cached) {
    if (cached.removed) return this.evict(file, cached);
    if (!cached.url || this.inactive.has(file)) return;
    this.inactive.set(file, cached);
    this.inactiveBytes += cached.bytes;
    while (this.inactiveBytes > this.budget) {
      const [oldest, entry] = this.inactive.entries().next().value!;
      this.evict(oldest, entry);
    }
  }

  private evict(file: string, cached: Cached) {
    this.wake(file);
    this.urls.delete(file);
    for (const id of cached.owners) if (this.sources.get(id) === file) this.sources.delete(id);
    if (cached.url) URL.revokeObjectURL(cached.url);
  }

  private changed() {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  close() {
    this.closed = true;
    this.unsubscribe();
    for (const [file, cached] of this.urls) this.evict(file, cached);
    this.pins.clear();
    this.listeners.clear();
  }
}
