export const count = (value: number) => value.toLocaleString('ko-KR');

export type Typed = { ok: true; value: number } | { ok: false; error: string };

// Bounds are each model's, so they are not checked here: a value past them is brought within them for that model, and
// the row says so.
export function readTyped(draft: string, whole: boolean): Typed {
  const value = Number(draft);
  if (draft.trim() === '' || !Number.isFinite(value)) return { ok: false, error: '숫자를 적어 주세요.' };
  if (whole && !Number.isSafeInteger(value)) return { ok: false, error: '정수로 적어 주세요.' };
  return { ok: true, value };
}
