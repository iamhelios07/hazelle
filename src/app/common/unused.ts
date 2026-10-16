import type { Unused } from '../../engine/pipeline';
import { withParticle } from './particles';

const LABEL: Record<Unused['kind'], (count: number) => string> = {
  bias: (count) => `바이어스 ${count}개`,
};

export function describeUnused(items: Unused[]): string | null {
  if (items.length === 0) return null;
  const list = items.map((item) => LABEL[item.kind](item.count)).join(' · ');
  return `${withParticle(list, '은/는')} 대화에 적용되지 않아요.`;
}
