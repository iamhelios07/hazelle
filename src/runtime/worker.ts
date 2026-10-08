type Policy = { createScriptURL(url: string): string };

// The CSP requires Trusted Types for script URLs. This policy is never exported: it signs only a URL handed to
// moduleWorker, whose callers pass their bundled `?worker&url` import.
const workers = new Set<string>();
const policy = (globalThis as { trustedTypes?: { createPolicy(name: string, rules: Policy): Policy } }).trustedTypes?.createPolicy('module-worker', {
  createScriptURL: (url) => {
    if (!workers.has(url)) throw new TypeError('not a bundled worker');
    return url;
  },
});

export function moduleWorker(url: string): Worker {
  workers.add(url);
  return new Worker((policy?.createScriptURL(url) ?? url) as string, { type: 'module' });
}

const BEAT_MS = 1000;

// A worker that leaves a ping unanswered past limit ms is held by a job that will not end. Counted from the ping, never
// from the clock alone: a hidden tab's timers run late, and the worker answers at once all the same. A beat that comes
// late to a shown tab pings again rather than judging, since the page itself was held and an answer may be waiting
// behind it; in a hidden tab every beat is late while the worker's messages are not.
export class Heartbeat {
  private beat: ReturnType<typeof setInterval> | null = null;
  private pinged: number | null = null;
  private last: number | null = null;
  private limit = 0;

  constructor(private readonly ping: () => void, private readonly stuck: () => void) {}

  // limit: for the job running now, which may differ from the one before it.
  start(limit: number) {
    this.limit = limit;
    this.beat ??= setInterval(() => this.check(), BEAT_MS);
  }

  answered() {
    this.pinged = null;
  }

  rest() {
    if (this.beat) clearInterval(this.beat);
    this.beat = null;
    this.pinged = null;
    this.last = null;
  }

  private check() {
    const now = Date.now();
    const late = this.last !== null && now - this.last > 2 * BEAT_MS && globalThis.document?.visibilityState !== 'hidden';
    this.last = now;
    if (this.pinged !== null && !late) {
      if (now - this.pinged > this.limit) this.stuck();
      return;
    }
    this.pinged = now;
    this.ping();
  }
}
