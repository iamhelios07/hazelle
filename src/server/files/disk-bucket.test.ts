import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { diskBucket } from './disk-bucket';

const INCARNATION = 'a'.repeat(32);
const PREFIX = `files/${INCARNATION}/`;
const key = (char: string) => `${PREFIX}${char.repeat(64)}`;

let dir = '';
const fresh = () => {
  dir = mkdtempSync(join(tmpdir(), 'hazelle-'));
  return diskBucket(dir);
};
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the disk bucket', () => {
  it('answers the bytes it was given, and null for an absent key', async () => {
    const bucket = fresh();
    await bucket.put(key('1'), new Uint8Array([1, 2, 3]));
    await bucket.put(key('2'), new Uint8Array([4]).buffer);
    expect(new Uint8Array(await new Response(await bucket.get(key('1'))).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(new Uint8Array(await new Response(await bucket.get(key('2'))).arrayBuffer())).toEqual(new Uint8Array([4]));
    expect(await bucket.get(key('3'))).toBeNull();
  });

  it('lists keys sorted, leaves no temp file, and deletes one key or the whole prefix', async () => {
    const bucket = fresh();
    for (const char of ['c', 'a', 'b']) await bucket.put(key(char), new Uint8Array([1]));
    expect(await bucket.list(PREFIX)).toEqual([key('a'), key('b'), key('c')]);
    expect(readdirSync(join(dir, PREFIX)).filter((name) => name.startsWith('.tmp-'))).toEqual([]);
    await bucket.delete(key('b'));
    await bucket.delete(key('b'));
    expect(await bucket.list(PREFIX)).toEqual([key('a'), key('c')]);
    await bucket.deletePrefix(PREFIX);
    expect(await bucket.list(PREFIX)).toEqual([]);
  });

  it('throws on a key or a prefix outside the layout', async () => {
    const bucket = fresh();
    await expect(bucket.put(`files/${INCARNATION}/../${'a'.repeat(64)}`, new Uint8Array())).rejects.toThrow(/Not a file key/);
    await expect(bucket.get(`files/${INCARNATION}/${'A'.repeat(64)}`)).rejects.toThrow(/Not a file key/);
    await expect(bucket.deletePrefix('files/')).rejects.toThrow(/Not a file prefix/);
  });
});
