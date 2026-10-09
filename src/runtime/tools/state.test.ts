import { expect, it } from 'vitest';
import { decodeState, encodeState } from './state';

it('keeps saved JSON null distinct from the shared variable deletion marker', () => {
  for (const value of [null, true, 1, 'text', ['a', null], { name: 'Jin' }]) {
    expect(decodeState(encodeState(value))).toEqual(value);
    expect(JSON.parse(encodeState(value))).toEqual(value);
  }
  expect(decodeState(undefined)).toBeUndefined();
  expect(decodeState(encodeState(undefined))).toBeUndefined();
  expect(encodeState(undefined)).toBe('null');
  expect(() => decodeState('not JSON')).toThrow();
});
