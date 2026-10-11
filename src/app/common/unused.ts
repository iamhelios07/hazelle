import type { Unused } from '../../engine/pipeline';

const LABEL: Record<Unused['kind'], (count: number) => string> = {
  bias: (count) => `바이어스 ${count}개`,
};

// 는 fits because every label ends in 개; a label ending in a final consonant would take 은.
export function describeUnused(items: Unused[]): string | null {
  if (items.length === 0) return null;
  const list = items.map((item) => LABEL[item.kind](item.count)).join(' · ');
  return `${list}는 대화에 적용되지 않아요.`;
}
