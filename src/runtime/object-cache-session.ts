import { GenerationChanged, type CachedScope, type CacheWrite, type DeviceCache, type Generation } from './object-cache';

// A store a restore ended hands the device copy on through its clear: the next store of this page opens it only once
// that ran, and not at all if it failed, since the copy still holds the ended timeline.
const handed = new WeakMap<DeviceCache, Promise<boolean>>();

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
    if ((await handed.get(this.cache)) === false) throw new Error('The device copy holds an ended timeline');
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

  // Run by a store that is ending, so it is not skipped as the store's other queued work is, nor after a failed
  // transaction, whose prefix it wipes. A copy another tab moved is that tab's, and opens.
  clear() {
    const cache = this.cache;
    if (!cache) return;
    let cleared = false;
    this.enqueue(async (generation) => {
      try { this.generation = await cache.clear(generation); } catch (error) { if (!(error instanceof GenerationChanged)) throw error; }
      cleared = true;
    }, true);
    handed.set(cache, this.queue.then(() => cleared));
  }

  adopt(timeline: string) {
    if (this.cache) this.enqueue(async (generation) => { this.generation = await this.cache!.adopt(generation, timeline); });
  }

  // A failed transaction leaves a valid prefix: no later cursor may pass rows it failed to save. An ending store's
  // queued work is skipped. A changed generation is not a failure: another tab moved the cache, so the store ends.
  private enqueue(work: (generation: Generation) => Promise<void>, ending = false) {
    this.queue = this.queue.then(async () => {
      if (ending || (!this.failed && !this.ending.aborted)) await work(this.generation!);
    }).catch((error: unknown) => {
      if (!(error instanceof GenerationChanged)) this.failed = true;
      else if (!this.ending.aborted) this.moved();
    });
  }
}
