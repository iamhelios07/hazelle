import { expect, it } from 'vitest';
import { TIME_FORMAT, typedTime } from './time';

it('reads a typed time on the device clock, and refuses a day or hour that does not exist', () => {
  expect(typedTime(` ${TIME_FORMAT} `)).toBe(new Date(2026, 9, 1, 15, 30).getTime());
  expect([typedTime('2026-02-30 10:00'), typedTime('2026-10-01 24:00'), typedTime('10월 1일 15:30'), typedTime('')]).toEqual([undefined, undefined, undefined, undefined]);
});
