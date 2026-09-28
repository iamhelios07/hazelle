import { describe, expect, it } from 'vitest';
import { randomBytes } from '../vault/aead';
import { getBlob, putBlob, removeBlob } from './blobs';
import { fakeServer } from './fake-server';

const A = 'blob-a';
const B = 'blob-b';

describe('blobs', () => {
  it('round-trips bytes the server only sees sealed, and removes them', async () => {
    const server = fakeServer();
    const vault = { accountId: 'account-1', vaultKey: randomBytes(32), request: server.request };
    const image = randomBytes(1024);
    expect(await putBlob(vault, A, image)).toEqual({ ok: true, data: undefined });
    expect(server.blobs.get(A)!.length).toBe(image.length + 29);
    expect(await getBlob(vault, A)).toEqual({ ok: true, data: image });

    await removeBlob(vault, A);
    expect(await getBlob(vault, A)).toEqual({ ok: false, error: 'not-found' });
  });

  it('refuses a blob moved to another id or account, or opened with another key', async () => {
    const server = fakeServer();
    const vault = { accountId: 'account-1', vaultKey: randomBytes(32), request: server.request };
    await putBlob(vault, A, randomBytes(64));
    server.blobs.set(B, server.blobs.get(A)!);
    expect(await getBlob(vault, B)).toEqual({ ok: false, error: 'unreadable' });
    expect(await getBlob({ ...vault, accountId: 'account-2' }, A)).toEqual({ ok: false, error: 'unreadable' });
    expect(await getBlob({ ...vault, vaultKey: randomBytes(32) }, A)).toEqual({ ok: false, error: 'unreadable' });
    expect((await getBlob(vault, A)).ok).toBe(true);
  });
});
