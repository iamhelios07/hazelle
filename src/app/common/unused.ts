import type { Unused } from '../../engine/pipeline';

const LABEL: Record<Unused['kind'], (count: number) => string> = {
  bias: (count) => `바이어스 ${count}개`,
  utility: () => '유틸리티 봇 설정',
  trigger: (count) => `트리거 ${count}개`,
};

// What a character brought that its chats do not use yet, or null.
export function describeUnused(items: Unused[]): string | null {
  if (items.length === 0) return null;
  return `${items.map((item) => LABEL[item.kind](item.count)).join(' · ')}는 아직 대화에 쓰이지 않아요.`;
}
