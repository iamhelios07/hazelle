import { describe, expect, it } from 'vitest';
import { tokenBucket } from './limits';

const setup = (perMinute: number) => {
  let now = 0;
  const limiter = tokenBucket(perMinute, () => now);
  const burst = (key: string) => {
    let passed = 0;
    while (limiter.limit(key).success) passed++;
    return passed;
  };
  return { limiter, burst, advance: (ms: number) => void (now += ms) };
};

describe('the token bucket', () => {
  it('passes a burst of perMinute and refuses the next', () => {
    const { limiter } = setup(20);
    for (let i = 0; i < 20; i++) expect(limiter.limit('a').success).toBe(true);
    expect(limiter.limit('a').success).toBe(false);
  });

  it('refills in proportion to the time passed, up to a full burst', () => {
    const { burst, advance } = setup(240);
    expect(burst('a')).toBe(240);
    advance(15_000);
    expect(burst('a')).toBe(60);
    advance(60_000);
    expect(burst('a')).toBe(240);
    advance(10 * 60_000);
    expect(burst('a')).toBe(240);
  });

  it('keeps keys independent', () => {
    const { burst } = setup(20);
    expect(burst('a')).toBe(20);
    expect(burst('b')).toBe(20);
  });

  it('evicts an idle key, which starts full, and keeps a recent one drained', () => {
    const { limiter, burst, advance } = setup(20);
    burst('idle');
    advance(10 * 60_000);
    burst('recent');
    advance(1_000);
    limiter.evict();
    expect(limiter.limit('recent').success).toBe(false);
    expect(burst('idle')).toBe(20);
  });
});
