import { unpack } from 'msgpackr';
import { expect, it } from 'vitest';
import { readMsgpack, writeMsgpack } from './msgpack';

it('writes what msgpackr, which Risu reads presets with, reads back the same, at every length and number width', () => {
  const value = {
    nil: null,
    flags: [true, false],
    ints: [0, 127, 128, 255, 256, 65535, 65536, 2 ** 32 - 1, 2 ** 32, -1, -32, -33, -128, -129, -32768, -32769, -(2 ** 31), -(2 ** 31) - 1],
    floats: [0.5, -1.25, 1e300],
    strings: ['', '한글 이모지 🐶', 'x'.repeat(31), 'x'.repeat(32), 'x'.repeat(255), 'x'.repeat(256), 'x'.repeat(65536)],
    arrays: [Array.from({ length: 15 }, (_, i) => i), Array.from({ length: 16 }, (_, i) => i), Array.from({ length: 65536 }, () => 1)],
    maps: [Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`k${i}`, i]))],
    bins: [new Uint8Array([1, 2, 3]), new Uint8Array(256).fill(7), new Uint8Array(65536).fill(9)],
  };
  const written = writeMsgpack({ ...value, gone: undefined });
  const theirs = unpack(written) as Record<string, unknown>;
  expect(Object.keys(theirs)).not.toContain('gone');
  const read: Record<string, unknown> = { ...theirs, bins: (theirs.bins as Uint8Array[]).map((bin) => new Uint8Array(bin)) };
  for (const [key, expected] of Object.entries(value)) expect(read[key], key).toEqual(expected);
  expect(readMsgpack(written)).toEqual(value);
});
