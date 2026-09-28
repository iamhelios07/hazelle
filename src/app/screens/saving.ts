import type { Progress } from '../../runtime/library';

// What a busy button or dialog says while a character is being saved (import and 사본 만들기).
export function describeStep(step: Parameters<Progress>[0]): string {
  return step.kind === 'picture' ? '그림 올리는 중' : `로어북 저장 중 · ${step.saved} / ${step.total}`;
}
