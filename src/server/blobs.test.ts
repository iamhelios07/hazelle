import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sessionCookie, signupBody, testApp } from './testing';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.dispose());
beforeEach(() => t.reset());

const A = '11111111-1111-4111-8111-111111111111';

async function signedIn() {
  const body = signupBody();
  return { accountId: body.accountId, cookie: sessionCookie(await t.post('signup', body)) };
}

function put(id: string, bytes: Uint8Array<ArrayBuffer>, cookie?: string) {
  return t.raw(`blobs/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream', ...(cookie ? { cookie } : {}) },
    body: bytes,
  });
}

describe('blobs', () => {
  it('stores under the account, reads back as bytes, and deletes idempotently', async () => {
    const { accountId, cookie } = await signedIn();
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    expect((await put(A, bytes, cookie)).status).toBe(204);
    expect(new Uint8Array(await (await t.env.BLOBS.get(`${accountId}/${A}`))!.arrayBuffer())).toEqual(bytes);

    const read = await t.get(`blobs/${A}`, cookie);
    expect(read.status).toBe(200);
    expect(read.headers.get('content-type')).toBe('application/octet-stream');
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(bytes);

    expect((await t.delete(`blobs/${A}`, undefined, cookie)).status).toBe(204);
    expect((await t.delete(`blobs/${A}`, undefined, cookie)).status).toBe(204);
    const gone = await t.get(`blobs/${A}`, cookie);
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ error: 'not-found' });
  });

  it("never reads another account's blob", async () => {
    const { cookie } = await signedIn();
    await t.env.BLOBS.put(`other/${A}`, new Uint8Array([1]));
    expect((await t.get(`blobs/${A}`, cookie)).status).toBe(404);
  });

  it('refuses a malformed id, an oversized body and a missing session', async () => {
    const { cookie } = await signedIn();
    expect((await put('not-a-uuid', new Uint8Array([1]), cookie)).status).toBe(400);
    const tooLarge = await put(A, new Uint8Array(25 * 1024 * 1024 + 1), cookie);
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toEqual({ error: 'too-large' });
    expect((await put(A, new Uint8Array([1]))).status).toBe(401);
    expect((await t.get(`blobs/${A}`)).status).toBe(401);
  });
});
