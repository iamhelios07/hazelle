import type { ModelUsage } from '../../model/chat';
import { UNKNOWN } from './words';

// A total leaves out the calls that did not report it, and says how many there were.
export function tally({ total, unknown }: ModelUsage['input'], calls: number): string {
  if (unknown === calls) return UNKNOWN;
  const sum = total.toLocaleString('ko-KR');
  return unknown ? `${sum} · ${unknown}번은 알 수 없음` : sum;
}
