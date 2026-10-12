import type { ModelUsage } from '../../model/usage';
import { money } from './money';
import { count } from './typedNumber';
import { UNKNOWN } from './words';

// A total leaves out the calls that did not report it, and says how many there were.
export function tally({ total, unknown }: ModelUsage['input'], calls: number): string {
  if (unknown === calls) return UNKNOWN;
  const sum = count(total);
  return unknown ? `${sum} · ${unknown}번은 알 수 없음` : sum;
}

// Each unit's sum apart, 약 once any part came from a price list, and the calls that reported no cost counted.
export function spent({ costs, costUnknown }: ModelUsage): string {
  if (!costs.length) return UNKNOWN;
  const sums = costs.map(({ unit, amount, estimated }) => `${estimated ? '약 ' : ''}${money(unit, amount)}`).join(' + ');
  return costUnknown ? `${sums} · ${UNKNOWN} ${costUnknown}회` : sums;
}
