import type { Cost } from '../../connectors/types';
import { money } from './money';

// A fact the provider did not report reads as unknown, never as zero.
export const UNKNOWN = '알 수 없음';

export const seconds = (ms: number | null) => (ms === null ? UNKNOWN : `${(ms / 1000).toFixed(1)}초`);
export const tokens = (count: number | null) => (count === null ? UNKNOWN : count.toLocaleString('ko-KR'));

// A cost the app worked out from a price table is an estimate, and says so.
export function cost(value: Cost | 'pending' | null): string {
  if (value === null) return UNKNOWN;
  if (value === 'pending') return '확인 중…';
  const amount = money(value.unit, value.amount);
  return value.source === 'price-list' ? `약 ${amount}` : amount;
}

// A reply that came in one piece, as from a provider that does not stream, has no speed to measure.
const MEASURABLE_MS = 250;

export function speed(outputTokens: number | null, firstTextMs: number | null, totalMs: number): string {
  if (outputTokens === null || firstTextMs === null || totalMs - firstTextMs < MEASURABLE_MS) return UNKNOWN;
  return `${Math.round(outputTokens / ((totalMs - firstTextMs) / 1000))} tok/s`;
}
