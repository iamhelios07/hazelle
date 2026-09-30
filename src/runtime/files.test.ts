import { describe, expect, it } from 'vitest';
import { randomBytes } from '../vault/aead';
import { sealFile } from '../vault/files';
import { testServer } from './testing';

const server = testServer();

describe('files', () => {
  it('stores the same content as one file, whenever it is saved, and reads it back', async () => {
    const { files } = await server.account();
    const image = randomBytes(1024);
    const first = await files.save([image, image]);
    expect(first.ok && first.data[0]).toEqual((await sealFile(image)).ref);
    const again = await files.save([image]);
    expect(again).toEqual(first.ok && { ok: true, data: [first.data[0]] });
    expect(await files.read(first.ok ? first.data[0]! : { id: '', key: '' })).toEqual({ ok: true, data: image });
  });

  it('refuses a body opened with another file’s key', async () => {
    const { files } = await server.account();
    const saved = await files.save([randomBytes(64), randomBytes(64)]);
    const [a, b] = saved.ok ? saved.data : [];
    expect(await files.read({ id: a!.id, key: b!.key })).toEqual({ ok: false, error: 'unreadable' });
  });
});
