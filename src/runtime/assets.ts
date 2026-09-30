import type { Files } from './files';
import type { ObjectStore } from './store';

const PERMANENT = new Set(['not-found', 'unreadable']);

// Bots' pictures as the chat shows them: each file read, opened and made a blob URL once a session, and let go when
// the session closes.
export class AssetUrls {
  // By file id; null while one is read, and for one that is gone or does not open, which is not tried again this
  // session. One that failed on the way is forgotten, so the next draw tries it again.
  private readonly urls = new Map<string, string | null>();
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private closed = false;

  constructor(
    private readonly store: ObjectStore,
    private readonly files: Files,
  ) {}

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = () => this.version;

  // An asset's picture, once it is ready. The first ask starts reading it; undefined until then, and for an asset
  // that is gone or a file that cannot be read.
  url(id: string): string | undefined {
    const asset = this.store.get('asset', id)?.value;
    if (!asset) return undefined;
    const { file, type } = asset;
    if (!this.urls.has(file.id)) {
      this.urls.set(file.id, null);
      void this.files.read(file).then((read) => {
        if (this.closed) return;
        if (!read.ok) {
          if (!PERMANENT.has(read.error)) this.urls.delete(file.id);
          return;
        }
        this.urls.set(file.id, URL.createObjectURL(new Blob([read.data], { type })));
        this.version++;
        for (const listener of this.listeners) listener();
      });
    }
    return this.urls.get(file.id) ?? undefined;
  }

  close() {
    this.closed = true;
    for (const url of this.urls.values()) if (url) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}
