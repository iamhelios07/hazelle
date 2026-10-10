import type { Unused } from '../../engine/pipeline';
import { finalOf } from './languages';

const LABEL: Record<Unused['kind'], (count: number) => string> = {
  bias: (count) => `바이어스 ${count}개`,
  utility: () => '유틸리티 봇 설정',
};

// 은 after a syllable with a final consonant (설정은), 는 otherwise (개는); a word ending outside Hangul takes 는.
const topic = (word: string) => {
  const final = finalOf(word);
  return final !== null && final !== 0 ? '은' : '는';
};

export function describeUnused(items: Unused[]): string | null {
  if (items.length === 0) return null;
  const list = items.map((item) => LABEL[item.kind](item.count)).join(' · ');
  return `${list}${topic(list)} 대화에 적용되지 않아요.`;
}
