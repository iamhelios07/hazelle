import { deflateSync, gzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { gunzip, inflate } from './inflate';

// Bytes that barely pack, so the packed form spans several steps.
const noise = (length: number) => {
  let state = 1;
  return Uint8Array.from({ length }, () => (state = (state * 1103515245 + 12345) & 0x7fffffff) >> 16);
};

describe('inflate and gunzip', () => {
  it('read data whose packed form spans several steps', () => {
    const data = noise(300_000);
    expect(inflate(deflateSync(data), data.length)).toEqual(data);
    expect(gunzip(gzipSync(data))).toEqual(data);
  });

  it('refuse an output that is not the size declared for it, larger or smaller', () => {
    const data = new Uint8Array(100_000).fill(7);
    const packed = deflateSync(data);
    expect(() => inflate(packed, 0xffffffff)).toThrow('less data than declared');
    expect(() => inflate(packed, 99_999)).toThrow('more data than declared');
    const file = gzipSync(data);
    new DataView(file.buffer).setUint32(file.length - 4, 0xffffffff, true);
    expect(() => gunzip(file)).toThrow('less data than declared');
  });
});
