import type { CacheForecast, CacheRecurrence, CacheShortfall } from '../model/cache';
import type { Receipt } from '../model/chat';

const RECENT = 10;

export function cacheRecurrence(receipts: Receipt[]): CacheRecurrence {
  const result: CacheRecurrence = { considered: 0, missing: 0, broken: 0, causes: [] };
  for (const { forecast } of receipts.slice(0, RECENT)) {
    if (!forecast) { result.missing++; continue; }
    result.considered++;
    const cause = forecast.broken;
    if (!cause) continue;
    result.broken++;
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
