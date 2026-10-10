import type { Cost } from '../../connectors/types';
import { money } from './money';
import { monthDay } from './time';
import { count } from './typedNumber';
import { UNKNOWN } from './words';

// A fact the provider did not report reads as unknown, never as zero.
export const seconds = (ms: number | null) => (ms === null ? UNKNOWN : `${(ms / 1000).toFixed(1)}초`);
export const tokens = (value: number | null) => (value === null ? UNKNOWN : count(value));

// A cost the app worked out from a price is an estimate, and says so, with the date of a models.dev price.
export function cost(value: Cost | 'pending' | null): string {
  if (value === null) return UNKNOWN;
  if (value === 'pending') return '확인 중…';
  const amount = money(value.unit, value.amount);
  if (value.source === 'reported') return amount;
  return value.asOf === undefined ? `약 ${amount}` : `약 ${amount} · 가격표 ${monthDay(value.asOf)} 기준`;
}

// A reply that came in one piece, as from a provider that does not stream, has no speed to measure.
const MEASURABLE_MS = 250;

export function speed(outputTokens: number | null, firstTextMs: number | null, totalMs: number): string {
  if (outputTokens === null || firstTextMs === null || totalMs - firstTextMs < MEASURABLE_MS) return UNKNOWN;
  return `${Math.round(outputTokens / ((totalMs - firstTextMs) / 1000))} tok/s`;
}
