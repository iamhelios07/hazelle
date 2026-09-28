import type { Bounds } from '../../connectors/settings';

export const count = (value: number) => value.toLocaleString('ko-KR');

export type Typed = { ok: true; value: number } | { ok: false; error: string };

// A number typed into a setting, or the words for what is wrong with it. fits is the schema's verdict
// (connectors/settings problems()), so the bounds here only choose the words. capped: the upper bound
// is the model's own limit, such as its longest reply.
export function readTyped(draft: string, rule: Bounds & { whole: boolean }, fits: (value: number) => boolean, capped = false): Typed {
  const value = Number(draft);
  if (draft.trim() === '' || !Number.isFinite(value)) return { ok: false, error: '숫자를 적어 주세요.' };
  if (fits(value)) return { ok: true, value };
  if (rule.whole && !Number.isSafeInteger(value)) return { ok: false, error: '정수로 적어 주세요.' };
  const { min, max } = rule;
  if (capped && max !== null && value > max) return { ok: false, error: `이 모델은 ${count(max)}까지예요.` };
  if (min !== null && max !== null) return { ok: false, error: `${count(min)} ~ ${count(max)} 사이로 적어 주세요.` };
  if (min !== null) return { ok: false, error: `${count(min)} 이상으로 적어 주세요.` };
  return { ok: false, error: `${count(max ?? value)} 이하로 적어 주세요.` };
}

export const clamp = (value: number, { min, max }: Bounds) => Math.min(max ?? value, Math.max(min ?? value, value));
