// A token bucket per key, in process: calls (240 a minute per account), bot calls (20 a minute per account:chat) and
// the visitors of share links (visitorLimits). The caller picks the key.

export type Limiter = { limit(key: string): { success: boolean } };

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
