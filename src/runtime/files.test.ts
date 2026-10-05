import { describe, expect, it } from 'vitest';
import { randomBytes } from '../vault/aead';
import { sealFile } from '../vault/files';
import { api } from './api';
import { Files } from './files';
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

describe('files on a bad link', () => {
  it('waits out a dropped connection while uploading, then saves', async () => {
    const { store } = await server.account();
    let dropped = 0;
    const files = new Files(async <T,>(...args: Parameters<typeof api>) => {
      if (args[0] === 'PUT' && dropped++ === 0) return { ok: false as const, error: 'offline' };
      return api<T>(...args);
    }, store);
    const image = randomBytes(256);
    const saved = await files.save([image]);
    expect(saved).toEqual({ ok: true, data: [(await sealFile(image)).ref] });
    expect(dropped).toBe(2);
  });

  it('waits out a dropped connection while reading a picture, then opens it', async () => {
    const { store } = await server.account();
    let dropped = 0;
    const files = new Files(async <T,>(...args: Parameters<typeof api>) => {
      if (args[0] === 'GET' && dropped++ === 0) return { ok: false as const, error: 'offline' };
      return api<T>(...args);
    }, store);
    const image = randomBytes(256);
    const saved = await files.save([image]);
    expect(saved.ok).toBe(true);
    expect(await files.read((saved as { ok: true; data: { id: string; key: string }[] }).data[0]!)).toEqual({ ok: true, data: image });
    expect(dropped).toBe(2);
  });

  it('ends a read that waits on a dead link when its signal aborts', async () => {
    const { store } = await server.account();
    const files = new Files(async <T,>(...args: Parameters<typeof api>) => (args[0] === 'GET' ? { ok: false as const, error: 'offline' } : api<T>(...args)), store);
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 50);
    expect(await files.read({ id: 'a'.repeat(64), key: 'b'.repeat(43) }, { signal: abort.signal })).toEqual({ ok: false, error: 'stopped' });
  });

  it('never sends a body past the size the server names, and leaves it out of the result', async () => {
    const { store } = await server.account();
    const puts: string[] = [];
    const files = new Files(async <T,>(...args: Parameters<typeof api>) => {
      if (args[0] === 'PUT') puts.push(args[1]);
      const result = await api<T>(...args);
      return args[1] === 'files/missing' && result.ok ? { ok: true as const, data: { ...(result.data as object), maxBytes: 100 } as T } : result;
    }, store);
    const [small, big] = [randomBytes(32), randomBytes(200)];
    const saved = await files.save([small, big]);
    expect(saved).toEqual({ ok: true, data: [(await sealFile(small)).ref, null] });
    expect(puts).toEqual([`files/${(await sealFile(small)).ref.id}`]);
  });
});
