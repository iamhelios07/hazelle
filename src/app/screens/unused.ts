import type { Unused } from '../../engine/prompt';

const LABEL: Record<Unused['kind'], (count: number) => string> = {
  lorebook: (count) => `로어북 ${count}개`,
  regex: (count) => `정규식 ${count}개`,
  cbs: (count) => `CBS 태그 ${count}개`,
  variables: (count) => `기본 변수 ${count}개`,
  toggles: () => '토글',
  bias: (count) => `바이어스 ${count}개`,
  utility: () => '유틸리티 봇 설정',
};

// What a character brought that its chats do not use yet (runtime/prompt unused), or null.
export function describeUnused(items: Unused[]): string | null {
  if (items.length === 0) return null;
  return `${items.map((item) => LABEL[item.kind](item.count)).join(' · ')}는 아직 대화에 쓰이지 않아요.`;
}
