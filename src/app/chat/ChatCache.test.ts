import { describe, expect, it } from 'vitest';
import { why } from './ChatCache';

describe('why a send would not read the cache', () => {
  it('names the 모델 설정 that has the cache off for the next send, and none for an earlier request', () => {
    expect(why({ kind: 'off' }, '기본')).toBe("'기본' 모델 설정에서는 캐시가 꺼져 있어요.");
    expect(why({ kind: 'off' }, null)).toBe('이 모델 설정에서는 캐시가 꺼져 있어요.');
  });
});
