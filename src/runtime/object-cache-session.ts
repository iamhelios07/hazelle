import { GenerationChanged, type CachedScope, type CacheWrite, type DeviceCache, type Generation } from './object-cache';

export class ObjectCacheSession {
  private generation: Generation | null = null;
  private failed = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly cache: DeviceCache | undefined, private readonly ending: AbortSignal, private readonly moved: () => void) {}

  get enabled(): boolean { return this.cache !== undefined; }
  get available(): boolean { return this.enabled && !this.failed; }
  get settled(): Promise<void> { return this.queue; }

  async open() {
    if (!this.cache || this.failed) return null;
    const opened = await this.cache.open();
    if (this.ending.aborted) return null;
    this.generation = opened.generation;
    return opened;
  }

  // Reads from another generation never reach the caller's chat scope.
  async read(chat: string): Promise<CachedScope | null> {
    const generation = this.generation;
    if (!this.cache || this.failed || generation?.timeline == null) return null;
    return this.cache.read(generation, chat).catch((error: unknown) => {
      if (error instanceof GenerationChanged && !this.ending.aborted) this.moved();
      return null;
    });
  }

  write(write: CacheWrite) {
    if (this.cache) this.enqueue((generation) => this.cache!.write(generation, write));
  }

  // Run by a store that is ending, so it is not skipped as the store's other queued work is.
  clear() {
    if (this.cache) this.enqueue(async (generation) => { this.generation = await this.cache!.clear(generation); }, true);
  }

  adopt(timeline: string) {
    if (this.cache) this.enqueue(async (generation) => { this.generation = await this.cache!.adopt(generation, timeline); });
  }

  // A failed transaction leaves a valid prefix: no later cursor may pass rows it failed to save. An ending store's
  // queued work is skipped. A changed generation is not a failure: another tab moved the cache, so the store ends.
  private enqueue(work: (generation: Generation) => Promise<void>, ending = false) {
    this.queue = this.queue.then(async () => {
      if (!this.failed && (ending || !this.ending.aborted)) await work(this.generation!);
    }).catch((error: unknown) => {
      if (!(error instanceof GenerationChanged)) this.failed = true;
      else if (!this.ending.aborted) this.moved();
    });
  }
}
