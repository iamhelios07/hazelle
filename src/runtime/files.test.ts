import { describe, expect, it } from 'vitest';
import { randomBytes } from '../vault/aead';
import { api } from './api';
import { Files } from './files';
import { testServer } from './testing';

const server = testServer();

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('files', () => {
  it('round-trips bytes the server only sees sealed, and removes them', async () => {
    const { files, blobs } = await server.account();
    const image = randomBytes(1024);
    expect(await files.put(A, image)).toEqual({ ok: true, data: undefined });
    expect((await blobs.get(A))!.length).toBe(image.length + 29);
    expect(await files.get(A)).toEqual({ ok: true, data: image });

    await files.remove(A);
    expect(await files.get(A)).toEqual({ ok: false, error: 'not-found' });
  });

  it('refuses a blob moved to another id or account, or opened with another key', async () => {
    const { accountId, vaultKey, files, blobs } = await server.account();
    await files.put(A, randomBytes(64));
    await blobs.put(B, (await blobs.get(A))!);
    expect(await files.get(B)).toEqual({ ok: false, error: 'unreadable' });
    expect(await (await Files.open(crypto.randomUUID(), vaultKey, api)).get(A)).toEqual({ ok: false, error: 'unreadable' });
    expect(await (await Files.open(accountId, randomBytes(32), api)).get(A)).toEqual({ ok: false, error: 'unreadable' });
    expect((await files.get(A)).ok).toBe(true);
  });
});
