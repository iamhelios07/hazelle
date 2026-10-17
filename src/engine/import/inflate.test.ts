import { deflateSync, gzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { gunzip, inflate, TooLarge } from './inflate';

// Bytes that barely pack, so the packed form spans several steps.
const noise = (length: number) => {
  let state = 1;
  return Uint8Array.from({ length }, () => (state = (state * 1103515245 + 12345) & 0x7fffffff) >> 16);
};

// toEqual walks 300,000 elements through its deep compare, past the timeout on a slow runner.
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i]);

describe('inflate and gunzip', () => {
  it('read data whose packed form spans several steps', () => {
    const data = noise(300_000);
    expect(same(inflate(deflateSync(data), data.length), data)).toBe(true);
    expect(same(gunzip(gzipSync(data), data.length), data)).toBe(true);
  });

  it('refuse an output that is not the size declared for it, larger or smaller', () => {
    const data = new Uint8Array(100_000).fill(7);
    const packed = deflateSync(data);
    expect(() => inflate(packed, 0xffffffff)).toThrow('less data than declared');
    expect(() => inflate(packed, 99_999)).toThrow('more data than declared');
    const file = gzipSync(data);
    new DataView(file.buffer).setUint32(file.length - 4, 0xffffffff, true);
    expect(() => gunzip(file, Infinity)).toThrow('less data than declared');
  });

  it('stop a gzip that unpacks past its limit', () => {
    expect(() => gunzip(gzipSync(new Uint8Array(100_000)), 99_999)).toThrow(TooLarge);
  });
});
