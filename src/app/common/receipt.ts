import type { Cost } from '../../connectors/types';
import type { Receipt } from '../../model/chat';
import { money } from './money';
import { count } from './typedNumber';
import { UNKNOWN } from './words';

// A fact the provider did not report reads as unknown, never as zero.
export const seconds = (ms: number | null) => (ms === null ? UNKNOWN : `${(ms / 1000).toFixed(1)}초`);
export const tokens = (value: number | null) => (value === null ? UNKNOWN : count(value));

// A cost the app worked out from a price is an estimate, and says so.
export function cost(value: Cost | 'pending' | null): string {
  if (value === null) return UNKNOWN;
  if (value === 'pending') return '확인하는 중…';
  const amount = money(value.unit, value.amount);
  return value.source === 'reported' ? amount : `약 ${amount}`;
}

export function usageLine({ usage, cost: spent }: Pick<Receipt, 'usage' | 'cost'>): string {
  const used = usage ? `입력 ${tokens(usage.inputTokens)} · 출력 ${tokens(usage.outputTokens)}` : `사용량 ${UNKNOWN}`;
  return `${used} · ${spent === null || spent === 'pending' ? `비용 ${cost(spent)}` : cost(spent)}`;
}

const CUT = { length: '길이 한도', stopped: '직접 중단', 'no-terminal': '중간에 끊김', refused: '제공자가 차단' } as const;

export function finish(receipt: Receipt): { label: string; value: string; tone?: 'warn' } {
  if (receipt.state === 'failed') return { label: '종료 사유', value: '실패', tone: 'warn' };
  if (receipt.cut === 'refused') return { label: '종료 사유', value: receipt.finishReason ? `${CUT.refused} (${receipt.finishReason})` : CUT.refused, tone: 'warn' };
  if (receipt.cut) return { label: '종료 사유', value: CUT[receipt.cut], tone: receipt.cut === 'stopped' ? undefined : 'warn' };
  return { label: '종료 사유', value: '정상 종료' };
}

// A reply that came in one piece, as from a provider that does not stream, has no speed to measure.
const MEASURABLE_MS = 250;

export function speed(outputTokens: number | null, firstTextMs: number | null, totalMs: number): string {
  if (outputTokens === null || firstTextMs === null || totalMs - firstTextMs < MEASURABLE_MS) return UNKNOWN;
  return `${Math.round(outputTokens / ((totalMs - firstTextMs) / 1000))} tok/s`;
}
