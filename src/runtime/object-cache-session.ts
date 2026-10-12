import { GenerationChanged, type CachedScope, type CacheWrite, type DeviceCache, type Generation } from './object-cache';

export class ObjectCacheSession {
  private generation: Generation | null = null;
  private failed = false;
  private queue: Promise<void> = Promise.resolve();
  // A reload after another tab moved the cache's generation, which a pull waits for before its next request.
  private pendingReload: Promise<void> | null = null;

  constructor(private readonly cache: DeviceCache | undefined, private readonly moved: () => void) {}

  get enabled(): boolean { return this.cache !== undefined; }
  get available(): boolean { return this.enabled && !this.failed; }
  get settled(): Promise<void> { return this.queue; }
  get reloading(): Promise<void> | null { return this.pendingReload; }

  async open(epochEnd: AbortSignal) {
    if (!this.cache || this.failed) return null;
    const opened = await this.cache.open();
    if (epochEnd.aborted) return null;
    this.generation = opened.generation;
    return opened;
  }

  // Reads from another generation never reach the caller's chat scope.
  async read(chat: string, epochEnd: AbortSignal): Promise<CachedScope | null> {
    const generation = this.generation;
    if (!this.cache || this.failed || generation?.timeline == null) return null;
    return this.cache.read(generation, chat).catch((error: unknown) => {
      if (error instanceof GenerationChanged && !epochEnd.aborted) this.moved();
      return null;
    });
  }

  write(write: CacheWrite, epochEnd: AbortSignal) {
    if (this.cache) this.enqueue((generation) => this.cache!.write(generation, write), epochEnd);
  }

  clear(epochEnd: AbortSignal) {
    if (this.cache) this.enqueue(async (generation) => { this.generation = await this.cache!.clear(generation); }, epochEnd);
  }

  adopt(timeline: string, epochEnd: AbortSignal) {
    if (this.cache) this.enqueue(async (generation) => { this.generation = await this.cache!.adopt(generation, timeline); }, epochEnd);
  }

  reload(load: () => Promise<void>): Promise<void> {
    const opening = this.queue.then(load).finally(() => {
      if (this.pendingReload === opening) this.pendingReload = null;
    });
    this.pendingReload = this.queue = opening;
    return opening;
  }

  disable() { this.failed = true; }

  // A failed transaction leaves a valid prefix: no later cursor may pass rows it failed to save. An ended epoch's
  // queued work is skipped. A changed generation is not a failure: another tab moved the cache, so the store reloads.
  private enqueue(work: (generation: Generation) => Promise<void>, epochEnd: AbortSignal) {
    this.queue = this.queue.then(async () => {
      if (!this.failed && !epochEnd.aborted) await work(this.generation!);
    }).catch((error: unknown) => {
      if (!(error instanceof GenerationChanged)) this.failed = true;
      else if (!epochEnd.aborted) this.moved();
    });
  }
}
