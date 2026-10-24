import type { CacheForecast, CacheRecurrence, CacheShortfall } from '../model/cache';
import type { Receipt } from '../model/chat';

const RECENT = 10;

// short: the reply's shortfall verdict (cacheShortfall), null where it could not be judged: nothing forecast to read,
// or no reported read.
export type JudgedReceipt = Pick<Receipt, 'forecast' | 'connection'> & { short: boolean | null };

export function cacheRecurrence(receipts: JudgedReceipt[]): CacheRecurrence {
  const result: CacheRecurrence = { considered: 0, missing: 0, broken: 0, short: 0, causes: [], streak: null };
  let streaking = true;
  for (const { forecast, connection, short } of receipts.slice(0, RECENT)) {
    if (streaking && short !== null) {
      if (short && (!result.streak || result.streak.connection === connection)) result.streak = { connection, count: (result.streak?.count ?? 0) + 1 };
      else streaking = false;
    }
    if (!forecast) { result.missing++; continue; }
    result.considered++;
    if (short) result.short++;
    const cause = forecast.broken;
    if (cause || short) result.broken++;
    if (!cause) continue;
    const key = (value: typeof cause) => JSON.stringify([value.kind, 'from' in value ? value.from : null]);
    const held = result.causes.find((item) => key(item.cause) === key(cause));
    if (held) held.count++;
    else result.causes.push({ cause, count: 1 });
  }
  return result;
}

export function cacheShortfall(forecast: CacheForecast | undefined, actual: number | null, ratio: number | null): CacheShortfall | null {
  if (!forecast || forecast.read <= 0 || actual === null) return null;
  const expected = forecast.read * (ratio ?? 1);
  return { expected, actual, ratio, short: actual < expected / 2 && expected - actual >= 128 };
}

// The first wire part a shortfall's read left out, null when it covers them all. A provider reads whole parts up to a
// cache point, so the read ends at the part boundary nearest its o200k reach; tokenizer noise makes that a neighbourhood.
export function readReach(parts: { tokens: number }[], { actual, ratio }: CacheShortfall): number | null {
  const reach = actual / (ratio ?? 1);
  let sum = 0;
  let best = 0;
  let gap = reach;
  for (const [index, { tokens }] of parts.entries()) {
    sum += tokens;
    if (Math.abs(sum - reach) < gap) [best, gap] = [index + 1, Math.abs(sum - reach)];
  }
  return best < parts.length ? best : null;
}
