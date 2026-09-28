import { describe, expect, it } from 'vitest';
import { randomBytes } from '../vault/aead';
import { getBlob, putBlob, removeBlob } from './blobs';
import { testServer } from './testing';

const server = testServer();

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('blobs', () => {
  it('round-trips bytes the server only sees sealed, and removes them', async () => {
    const { vault, blobs } = await server.account();
    const image = randomBytes(1024);
    expect(await putBlob(vault, A, image)).toEqual({ ok: true, data: undefined });
    expect((await blobs.get(A))!.length).toBe(image.length + 29);
    expect(await getBlob(vault, A)).toEqual({ ok: true, data: image });

    await removeBlob(vault, A);
    expect(await getBlob(vault, A)).toEqual({ ok: false, error: 'not-found' });
  });

  it('refuses a blob moved to another id or account, or opened with another key', async () => {
    const { vault, blobs } = await server.account();
    await putBlob(vault, A, randomBytes(64));
    await blobs.put(B, (await blobs.get(A))!);
    expect(await getBlob(vault, B)).toEqual({ ok: false, error: 'unreadable' });
    expect(await getBlob({ ...vault, accountId: crypto.randomUUID() }, A)).toEqual({ ok: false, error: 'unreadable' });
    expect(await getBlob({ ...vault, vaultKey: randomBytes(32) }, A)).toEqual({ ok: false, error: 'unreadable' });
    expect((await getBlob(vault, A)).ok).toBe(true);
  });
});
