// A token bucket per key, in process: calls (240 a minute per account), bot calls (20 a minute per account:chat) and
// the visitors of share links (visitorLimits). The caller picks the key.

export type Limiter = { limit(key: string): { success: boolean } };
export type UploadBudget = { take(size: number): Promise<boolean>; give(size: number): void };

// One process holds every upload body in its memory until the bytes are on disk, so what it holds at once is bounded
// by their bytes, not their count: a picture of ~100 KB never waits, and only bodies near MAX_FILE_BYTES share the
// budget. A size is never past the budget: worker.ts bounds a body by MAX_FILE_BYTES before its route runs.
const UPLOAD_BYTES = 256 * 1024 * 1024;
const UPLOAD_WAIT_MS = 30_000;

// Takers wait in order, so a body that fits is never passed by one that arrived later. The head leaving, by entering
// or by giving up, is what lets the next in, so a wait that runs out admits as a give does.
export function uploadBudget(bytes = UPLOAD_BYTES, waitMs = UPLOAD_WAIT_MS): UploadBudget {
  let free = bytes;
  const waiting: { size: number; enter: () => void }[] = [];
  const admit = () => {
    while (waiting.length && waiting[0]!.size <= free) {
      const next = waiting.shift()!;
      free -= next.size;
      next.enter();
    }
  };
  return {
    take: (size) =>
      new Promise<boolean>((resolve) => {
        if (waiting.length === 0 && free >= size) {
          free -= size;
          return resolve(true);
        }
        const waiter = {
          size,
          enter: () => {
            clearTimeout(timer);
            resolve(true);
          },
        };
        const timer = setTimeout(() => {
          waiting.splice(waiting.indexOf(waiter), 1);
          resolve(false);
          admit();
        }, waitMs);
        waiting.push(waiter);
      }),
    give: (size) => {
      free += size;
      admit();
    },
  };
}

// Idle this long, a bucket is full again anyway, so dropping it changes no answer.
const IDLE_MS = 10 * 60 * 1000;

// clock is monotonic (performance.now()): a wall-clock jump would refill or starve every bucket at once.
export function tokenBucket(perMinute: number, clock: () => number = () => performance.now()): Limiter & { evict(): void } {
  const buckets = new Map<string, { tokens: number; at: number }>();
  let evicted = clock();
  const evict = () => {
    const now = clock();
    evicted = now;
    for (const [key, bucket] of buckets) if (now - bucket.at >= IDLE_MS) buckets.delete(key);
  };
  return {
    evict,
    limit: (key) => {
      const now = clock();
      if (now - evicted >= IDLE_MS) evict();
      const bucket = buckets.get(key);
      const tokens = bucket ? Math.min(perMinute, bucket.tokens + ((now - bucket.at) * perMinute) / 60_000) : perMinute;
      const success = tokens >= 1;
      buckets.set(key, { tokens: success ? tokens - 1 : tokens, at: now });
      return { success };
    },
  };
}

// Per visitor on the anonymous share routes: a link's page and its count, its files (a 파일로 받기 reads every picture
// of a bot, which may be hundreds), and its reports. Requests, not bytes.
export const visitorLimits = () => ({ reads: tokenBucket(120), files: tokenBucket(1200), reports: tokenBucket(6) });
