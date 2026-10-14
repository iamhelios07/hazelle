import { describe, expect, it } from 'vitest';
import { tokenBucket, uploadBudget } from './limits';

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

describe('uploadBudget', () => {
  it('holds bodies by their bytes, lets waiters in by arrival order as bytes free, and answers false once the wait runs out', async () => {
    const budget = uploadBudget(10, 20);
    expect(await Promise.all([budget.take(6), budget.take(4)])).toEqual([true, true]);
    const big = budget.take(5);
    const small = budget.take(1);
    budget.give(4);
    let entered = false;
    void small.then(() => (entered = true));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(entered).toBe(false);
    budget.give(6);
    expect(await Promise.all([big, small])).toEqual([true, true]);
    expect(await budget.take(5)).toBe(false);
    budget.give(5);
    expect(await budget.take(5)).toBe(true);
  });

  it('lets the body behind a head that gave up in, without waiting for a give', async () => {
    const budget = uploadBudget(10, 20);
    expect(await budget.take(8)).toBe(true);
    const big = budget.take(5);
    const small = budget.take(2);
    expect(await big).toBe(false);
    expect(await Promise.race([small, new Promise((resolve) => setTimeout(() => resolve('late'), 10))])).toBe(true);
  });
});
