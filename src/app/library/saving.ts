import type { Progress } from '../../runtime/characters';

export function describeStep(step: Parameters<Progress>[0]): string {
  if (step.kind === 'picture') return '그림 올리는 중';
  return `${step.kind === 'assets' ? '에셋 올리는 중' : '저장 중'} · ${step.done} / ${step.total}`;
}
