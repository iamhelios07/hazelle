import { describe, expect, it } from 'vitest';
import { formatTime } from './time';

describe('formatTime', () => {
  it('reads every token once, in the given time zone, so A never rewrites a month name', () => {
    const ms = Date.UTC(2026, 7, 3, 20, 5, 9);
    expect(formatTime('YYYY YY MMMM MMM MM DDDD DD dddd ddd HH hh mm ss A X', ms, 'Asia/Seoul')).toBe(`2026 26 August Aug 08 216 04 Tuesday Tue 05 05 05 09 AM ${ms / 1000}`);
  });
});
