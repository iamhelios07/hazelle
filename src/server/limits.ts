import { createHmac, randomBytes } from 'node:crypto';

// A token bucket per key, in process: calls (240 a minute per account), bot calls (20 a minute per account:chat) and
// visitors (visitorLimits). The caller picks the key.

export type Limiter = { limit(key: string): { success: boolean } };
export type UploadBudget = { take(size: number): Promise<boolean>; give(size: number): void };

// enter: a live call of the account's own, or null while it holds LIVE_CALLS; the function it answers ends that call, once.
export type RelayAllowance = { visit(url: URL): boolean; take(bytes: number): boolean; enter(): (() => void) | null };
export type RelayBudget = { account(id: string): RelayAllowance };
export const RELAY_DAILY = { bytes: 4_000_000_000, hosts: 30 };
// Calls an account holds open at once: a detached reply while its call runs, a relayed call until its answer ends.
export const LIVE_CALLS = 32;

// Enforcement only: never expose, log or persist these counters or destination fingerprints. A new UTC day (or
// process) forgets them. Handles read the current day even when a detached call crosses midnight.
export function relayBudget(bytes = RELAY_DAILY.bytes, hosts = RELAY_DAILY.hosts, clock: () => number = Date.now, calls = LIVE_CALLS): RelayBudget {
  let day = -1;
  let secret = randomBytes(32);
  const accounts = new Map<string, { bytes: number; hosts: Set<string> }>();
  // Not the day's: a call running across midnight is still open, and a count cleared with the day would never close it.
  const live = new Map<string, number>();
  const current = (id: string) => {
    const today = Math.floor(clock() / 86_400_000);
    if (today !== day) {
      accounts.clear();
      secret = randomBytes(32);
      day = today;
    }
    let held = accounts.get(id);
    if (!held) {
      held = { bytes: 0, hosts: new Set() };
      accounts.set(id, held);
    }
    return held;
  };
  return {
    account: (id) => ({
      visit: (url) => {
        const held = current(id);
        const host = createHmac('sha256', secret).update(url.hostname.replace(/\.$/, '')).digest('hex');
        if (held.hosts.has(host)) return true;
        if (held.hosts.size >= hosts) return false;
        held.hosts.add(host);
        return true;
      },
      take: (size) => {
        const held = current(id);
        const fits = held.bytes < bytes && size <= bytes - held.bytes;
        held.bytes = Math.min(bytes, held.bytes + size);
        return fits;
      },
      enter: () => {
        const open = live.get(id) ?? 0;
        if (open >= calls) return null;
        live.set(id, open + 1);
        let ended = false;
        return () => {
          if (ended) return;
          ended = true;
          const left = live.get(id)! - 1;
          if (left) live.set(id, left);
          else live.delete(id);
        };
      },
    }),
  };
}

// One process holds every picture upload until its bytes are on disk, and every provider call's body while it is read
// and parsed (calls.ts), so what it holds at once is bounded by their bytes, not their count: a picture of ~100 KB or a
// short prompt never waits, and only bodies near MAX_FILE_BYTES or CALL_BYTES share the budget. A size is never past
// the budget: worker.ts bounds a body by its route's cap before the route runs.
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

const IDLE_MS = 10 * 60 * 1000;

// count per windowMs, refilled evenly. clock is monotonic (performance.now()): a wall-clock jump would refill or starve
// every bucket at once.
export function tokenBucket(count: number, windowMs = 60_000, clock: () => number = () => performance.now(), maxKeys = Infinity) {
  // Idle this long, a bucket is full again anyway, so dropping it changes no answer.
  const idleMs = Math.max(IDLE_MS, windowMs);
  const buckets = new Map<string, { tokens: number; at: number }>();
  let evicted = clock();
  const evict = () => {
    const now = clock();
    evicted = now;
    for (const [key, bucket] of buckets) if (now - bucket.at >= idleMs) buckets.delete(key);
  };
  return {
    evict,
    limit: (key: string) => {
      const now = clock();
      if (now - evicted >= idleMs) evict();
      const bucket = buckets.get(key);
      const tokens = bucket ? Math.min(count, bucket.tokens + ((now - bucket.at) * count) / windowMs) : count;
      const success = tokens >= 1;
      remember(buckets, key, { tokens: success ? tokens - 1 : tokens, at: now }, maxKeys);
      return { success, retryAfter: success ? 0 : Math.ceil(((1 - tokens) * windowMs) / count / 1000) };
    },
  };
}

function remember<T>(entries: Map<string, T>, key: string, value: T, maxKeys: number) {
  // At capacity forget the oldest key, never refuse all new visitors: a shared overflow lock would recreate the DoS.
  entries.delete(key);
  if (entries.size >= maxKeys) entries.delete(entries.keys().next().value!);
  entries.set(key, value);
}

const LOGIN_VISITORS = 10_000;
const FAILURE_IDLE_MS = 24 * 60 * 60_000;
type Failures = { count: number; until: number; at: number };

// No account-wide state: a stranger must never lock out the owner's address. IPs stay in memory only.
export function proofBackoff(clock: () => number = () => performance.now(), maxVisitors = LOGIN_VISITORS) {
  const visitors = new Map<string, { total: Failures; accounts: Map<string, Failures> }>();
  let evicted = clock();
  const evict = () => {
    const now = clock();
    evicted = now;
    for (const [key, visitor] of visitors) {
      if (now - visitor.total.at >= FAILURE_IDLE_MS) visitors.delete(key);
      else for (const [username, failures] of visitor.accounts) if (now - failures.at >= FAILURE_IDLE_MS) visitor.accounts.delete(username);
    }
  };
  const failed = (previous: Failures | undefined, free: number, now: number): Failures => {
    const count = Math.min((previous && now - previous.at < FAILURE_IDLE_MS ? previous.count : 0) + 1, free + 6);
    return { count, until: count < free ? now : now + Math.min(2 ** (count - free), 60) * 60_000, at: now };
  };
  return {
    evict,
    // Check and record together, with no await between them: concurrent proofs cannot pass a stale count.
    check(visitor: string, username: string, valid: boolean): number {
      const now = clock();
      if (now - evicted >= FAILURE_IDLE_MS) evict();
      let state = visitors.get(visitor);
      if (state && now - state.total.at >= FAILURE_IDLE_MS) {
        visitors.delete(visitor);
        state = undefined;
      }
      const pair = state?.accounts.get(username);
      const until = Math.max(state?.total.until ?? 0, pair?.until ?? 0);
      if (until > now) return Math.ceil((until - now) / 1000);
      if (valid) {
        // An attacker's own account cannot reset their spraying budget.
        state?.accounts.delete(username);
      } else {
        state ??= { total: { count: 0, until: 0, at: now }, accounts: new Map() };
        state.total = failed(state.total, 20, now);
        remember(state.accounts, username, failed(pair, 5, now), 32);
        remember(visitors, visitor, state, maxVisitors);
      }
      return 0;
    },
  };
}

// Per visitor on the anonymous share routes: a link's page and its count, its files (a 파일로 받기 reads every picture
// of a bot, which may be hundreds), and its reports. Requests, not bytes. signups: attempts an hour, so a script cannot
// fill signup_cap from one address.
export const visitorLimits = () => ({
  pulse: tokenBucket(240),
  reads: tokenBucket(120), files: tokenBucket(1200), reports: tokenBucket(6), signups: tokenBucket(10, 60 * 60_000),
  logins: tokenBucket(30, 60_000, () => performance.now(), LOGIN_VISITORS), proofs: proofBackoff(),
});
