import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hex } from './http';
import { sessionCookie, signupBody, testApp } from './testing';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.dispose());
beforeEach(() => t.reset());

const idOf = async (bytes: Uint8Array<ArrayBuffer>) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
const signedIn = async () => sessionCookie(await t.post('signup', signupBody()));
const put = (id: string, bytes: Uint8Array<ArrayBuffer>, cookie?: string) =>
  t.raw(`files/${id}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', ...(cookie ? { cookie } : {}) }, body: bytes });

describe('files', () => {
  it('stores a body under its hash once, outside any account, and says which ids are missing', async () => {
    const jin = await signedIn();
    const bytes = new Uint8Array([1, 2, 3, 250]);
    const id = await idOf(bytes);
    const absent = await idOf(new Uint8Array([9]));
    expect(await (await t.post('files/missing', { ids: [id, absent] }, jin)).json()).toEqual({ missing: [id, absent] });

    expect((await put(id, bytes, jin)).status).toBe(204);
    expect((await put(id, bytes, jin)).status).toBe(204);
    expect(await t.env.BLOBS.get(`files/${id}`)).not.toBeNull();
    expect(await (await t.post('files/missing', { ids: [id, absent] }, jin)).json()).toEqual({ missing: [absent] });

    const read = await t.get(`files/${id}`, jin);
    expect(read.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(bytes);
    expect((await t.get(`files/${absent}`, jin)).status).toBe(404);
  });

  it('refuses a body that is not its id, a bad id, an oversized body and a missing session', async () => {
    const cookie = await signedIn();
    const id = await idOf(new Uint8Array([1]));
    expect((await put(id, new Uint8Array([2]), cookie)).status).toBe(400);
    expect((await put('not-a-hash', new Uint8Array([1]), cookie)).status).toBe(400);
    expect((await put(id, new Uint8Array(25 * 1024 * 1024 + 1), cookie)).status).toBe(413);
    expect((await t.post('files/missing', { ids: ['x'] }, cookie)).status).toBe(400);
    expect((await put(id, new Uint8Array([1]))).status).toBe(401);
    expect((await t.get(`files/${id}`)).status).toBe(401);
  });

  it('keeps the file a live object names, visible to the server, and forgets it when the object goes', async () => {
    const cookie = await signedIn();
    const file = await idOf(new Uint8Array([1]));
    const A = '11111111-1111-4111-8111-111111111111';
    const named = () => t.env.DB.prepare('SELECT file_id FROM objects WHERE id = ?').bind(A).first('file_id');
    await t.post('objects/batch', { writes: [{ id: A, kind: 'asset', parent: null, body: 'Ym9keQ==', baseRev: null, file }] }, cookie);
    expect(await named()).toBe(file);
    await t.post('objects/batch', { writes: [{ id: A, kind: 'asset', parent: null, body: null, baseRev: 1 }] }, cookie);
    expect(await named()).toBeNull();
  });
});
