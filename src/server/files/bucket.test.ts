import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Bucket } from './bucket';
import { chooseBucket } from './choose';
import { diskBucket } from './disk-bucket';
import { fakeS3 } from './fake-s3';
import { r2Bucket } from './r2-bucket';

const INCARNATION = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);
const PREFIX = `files/${INCARNATION}/`;
const key = (char: string, prefix = PREFIX) => `${prefix}${char.repeat(64)}`;
const read = async (bucket: Bucket, at: string) => new Uint8Array(await new Response(await bucket.get(at)).arrayBuffer());

let dir = '';
let s3: Awaited<ReturnType<typeof fakeS3>>;
beforeAll(async () => {
  s3 = await fakeS3();
});
afterAll(() => s3.close());
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  s3.objects.clear();
});

const kinds = {
  disk: () => {
    dir = mkdtempSync(join(tmpdir(), 'hazelle-'));
    return diskBucket(dir);
  },
  r2: () => r2Bucket(s3.config),
};

describe.each(Object.entries(kinds))('the %s bucket', (_, fresh) => {
  it('answers the bytes it was given, and null for an absent key', async () => {
    const bucket = fresh();
    await bucket.put(key('1'), new Uint8Array([1, 2, 3]));
    await bucket.put(key('2'), new Uint8Array([4]).buffer);
    expect(await read(bucket, key('1'))).toEqual(new Uint8Array([1, 2, 3]));
    expect(await read(bucket, key('2'))).toEqual(new Uint8Array([4]));
    expect(await bucket.get(key('3'))).toBeNull();
  });

  it('lists keys sorted across pages, names each prefix once, and deletes one key or the whole prefix', async () => {
    const bucket = fresh();
    for (const char of ['c', 'a', 'b']) await bucket.put(key(char), new Uint8Array([1]));
    for (const char of ['d', 'e', 'f']) await bucket.put(key(char, `files/${OTHER}/`), new Uint8Array([1]));
    expect(await bucket.list(PREFIX)).toEqual([key('a'), key('b'), key('c')]);
    expect(await bucket.prefixes()).toEqual([PREFIX, `files/${OTHER}/`]);
    await bucket.delete(key('b'));
    await bucket.delete(key('b'));
    expect(await bucket.list(PREFIX)).toEqual([key('a'), key('c')]);
    await bucket.deletePrefix(PREFIX);
    expect(await bucket.list(PREFIX)).toEqual([]);
    expect(await bucket.prefixes()).toEqual([`files/${OTHER}/`]);
  });

  it('throws on a key or a prefix outside the layout', async () => {
    const bucket = fresh();
    await expect(bucket.put(`files/${INCARNATION}/../${'a'.repeat(64)}`, new Uint8Array())).rejects.toThrow(/Not a file key/);
    await expect(bucket.get(`files/${INCARNATION}/${'A'.repeat(64)}`)).rejects.toThrow(/Not a file key/);
    await expect(bucket.deletePrefix('files/')).rejects.toThrow(/Not a file prefix/);
  });
});

it('the disk bucket leaves no temp file and sweeps only a settled one', async () => {
  const bucket = kinds.disk();
  await bucket.put(key('a'), new Uint8Array([1]));
  expect(readdirSync(join(dir, PREFIX))).toEqual(['a'.repeat(64)]);
  for (const name of ['.tmp-old', '.tmp-new']) writeFileSync(join(dir, PREFIX, name), 'x');
  utimesSync(join(dir, PREFIX, '.tmp-old'), 1, 1);
  expect(await bucket.sweep(Date.now() - 60_000)).toEqual([`${PREFIX}.tmp-old`]);
});

it('the r2 bucket answers a key’s size, and a refusal names the request', async () => {
  const bucket = r2Bucket(s3.config);
  await bucket.put(key('a'), new Uint8Array([1, 2, 3]));
  expect(await bucket.head(key('a'))).toBe(3);
  expect(await bucket.head(key('b'))).toBeNull();
  await expect(r2Bucket({ ...s3.config, secretAccessKey: 'wrong' }).get(key('a'))).rejects.toThrow(`r2: get ${key('a')} answered 403`);
});

it('chooses the disk unless the environment names a whole R2 setting', () => {
  expect(chooseBucket({ HAZELLE_FILES_BUCKET: ' ' }, '/data').kind).toBe('disk');
  expect(() => chooseBucket({ HAZELLE_FILES_BUCKET: 's3' }, '/data')).toThrow(/must be disk or r2/);
  const r2 = { HAZELLE_FILES_BUCKET: 'r2', HAZELLE_FILES_R2_ENDPOINT: 'https://x.r2.cloudflarestorage.com', HAZELLE_FILES_R2_BUCKET: 'b', HAZELLE_FILES_R2_ACCESS_KEY_ID: 'k' };
  expect(() => chooseBucket(r2, '/data')).toThrow(/needs HAZELLE_FILES_R2_SECRET_ACCESS_KEY/);
  expect(chooseBucket({ ...r2, HAZELLE_FILES_R2_SECRET_ACCESS_KEY: 's' }, '/data').kind).toBe('r2');
});
