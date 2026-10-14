import { describe, expect, it, vi } from 'vitest';
import { randomBytes } from '../vault/aead';
import { sealFile } from '../vault/files';
import { api } from './api';
import { addAssets, copyCharacter, createCharacter, removeAssets, restoreAssets } from './characters';
import { Files } from './files';
import { fillPictures, importRisuChats } from './move';
import { markDeleted } from './removal';
import { testServer } from './testing';

const server = testServer();
const png = () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...randomBytes(16)]);

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

  it('sends no body past the room left under the picture cap, and leaves it out of the result', async () => {
    const { store } = await server.account();
    const [first, second] = [randomBytes(32), randomBytes(32)];
    const room = (await sealFile(first)).body.length;
    const puts: string[] = [];
    const files = new Files(async <T,>(...args: Parameters<typeof api>) => {
      if (args[0] === 'PUT') puts.push(args[1]);
      const result = await api<T>(...args);
      return args[1] === 'files/missing' && result.ok ? { ok: true as const, data: { ...(result.data as object), room } as T } : result;
    }, store);
    const saved = await files.save([first, second]);
    expect(saved).toEqual({ ok: true, data: [(await sealFile(first)).ref, null] });
    expect(puts).toEqual([`files/${(await sealFile(first)).ref.id}`]);
  });
});

describe('the sweep', () => {
  it('releases the files no object names, keeps one named in 휴지통, takes back a released one an object names again, and releases nothing on a walk with a row it cannot read', async () => {
    const { store, files } = await server.account();
    const [shown, binned] = [crypto.randomUUID(), crypto.randomUUID()];
    await createCharacter(store, 'shown', shown);
    await createCharacter(store, 'binned', binned);
    const picked = (bytes: Uint8Array<ArrayBuffer>) => [{ name: 'a.png', arrayBuffer: async () => bytes.buffer }];
    await addAssets(store, files, shown, picked(png()));
    await addAssets(store, files, binned, picked(png()));
    await markDeleted(store, 'character', binned, Date.now());
    const loose = await files.save([png()]);
    const ref = loose.ok ? loose.data[0]! : null;
    // Past the hour an upload's claim holds it.
    const later = Date.now() + 2 * 60 * 60 * 1000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => later);
    try {
      const scan = vi.spyOn(store, 'scan').mockImplementationOnce(async (_, visit) => {
        await visit({ id: 'x', kind: 'asset', parent: shown, rev: 1 }, undefined);
        return null;
      });
      expect(await files.release()).toEqual({ ok: false, error: 'unreadable' });
      scan.mockRestore();
      expect(await files.release()).toEqual({ ok: true, data: { released: 1, taken: 0 } });
      expect(await files.read(ref!)).toEqual({ ok: false, error: 'not-found' });
      await store.create('asset', { name: 'b', type: 'image/png', size: 24, file: ref! }, { parent: shown });
      expect(await files.release()).toEqual({ ok: true, data: { released: 0, taken: 0 } });
      expect((await files.read(ref!)).ok).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });

  it('rejects a stale walk when another tab undoes an asset removal, and reclaims an undo written after a release', async () => {
    const { store, files, open } = await server.account();
    const owner = crypto.randomUUID();
    await createCharacter(store, 'kept', owner);
    await addAssets(store, files, owner, [{ name: 'a.png', arrayBuffer: async () => png().buffer }]);
    const asset = store.children('asset', owner)[0]!;
    const other = await open();
    await other.pull();
    await removeAssets(store, [asset.id]);
    const later = Date.now() + 2 * 60 * 60 * 1000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
    const scan = store.scan.bind(store);
    const walking = vi.spyOn(store, 'scan').mockImplementation(async (options, visit, pin, signal) => {
      const result = await scan(options, visit, pin, signal);
      if (options.kind === 'asset') expect((await restoreAssets(other, [asset])).ok).toBe(true);
      return result;
    });
    try {
      expect(await files.release()).toEqual({ ok: false, error: 'conflict' });
      expect((await files.read(asset.value.file)).ok).toBe(true);
      walking.mockRestore();
      await store.pull();
      await removeAssets(store, [asset.id]);
      clock.mockReturnValue(later + 2 * 60 * 60 * 1000);
      expect(await files.release()).toEqual({ ok: true, data: { released: 1, taken: 0 } });
      expect((await restoreAssets(store, [asset])).ok).toBe(true);
      expect((await files.read(asset.value.file)).ok).toBe(true);
    } finally {
      walking.mockRestore();
      clock.mockRestore();
    }
  });

  it('walks again, a bounded number of times, when a write lands mid-walk', async () => {
    const { files } = await server.account();
    const release = vi.spyOn(files, 'release').mockResolvedValue({ ok: false, error: 'conflict' });
    await files.sweep();
    expect(release).toHaveBeenCalledTimes(3);
  });

  it('takes back the file a pending character copy captured before another tab removed its last reference', async () => {
    const { store, files, open } = await server.account();
    const owner = crypto.randomUUID();
    await createCharacter(store, 'source', owner);
    await addAssets(store, files, owner, [{ name: 'a.png', arrayBuffer: async () => png().buffer }]);
    const asset = store.children('asset', owner)[0]!;
    const other = await open();
    await other.pull();
    let held!: () => void;
    const heldPromise = new Promise<void>((resolve) => { held = resolve; });
    let resume!: () => void;
    const resumePromise = new Promise<void>((resolve) => { resume = resolve; });
    const batch = store.batch.bind(store);
    const writing = vi.spyOn(store, 'batch').mockImplementationOnce(async (...args) => {
      held();
      await resumePromise;
      return batch(...args);
    });
    const later = Date.now() + 2 * 60 * 60 * 1000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
    try {
      const copying = copyCharacter(store, owner, 'copy', () => {});
      await heldPromise;
      expect((await removeAssets(other, [asset.id])).ok).toBe(true);
      expect(await files.release()).toEqual({ ok: true, data: { released: 1, taken: 0 } });
      resume();
      const copied = await copying;
      expect(copied.ok).toBe(true);
      expect(copied.ok && store.children('asset', copied.data)[0]?.value.file).toEqual(asset.value.file);
      expect((await files.read(asset.value.file)).ok).toBe(true);
    } finally {
      resume();
      writing.mockRestore();
      clock.mockRestore();
    }
  });

  it('bounds the combined named and unused ids of every sweep request', async () => {
    const { store } = await server.account();
    const pin = await store.pin();
    if (!pin.ok) throw new Error(pin.error);
    const held = Array.from({ length: 1000 }, (_, i) => i.toString(16).padStart(64, '0'));
    const named = Array.from({ length: 500 }, (_, i) => (i + 1000).toString(16).padStart(64, '0'));
    const walking = vi.spyOn(store, 'scan').mockImplementation(async ({ kind }, visit) => {
      if (kind === 'asset') for (const id of named) await visit({ id, kind, parent: null, rev: 1 }, { file: { id } });
      return null;
    });
    const bodies: { unused: string[]; named: string[] }[] = [];
    const files = new Files(async <T,>(method: string, _path: string, body?: unknown) => {
      if (method === 'GET') return { ok: true, data: { ids: held, more: false, timeline: pin.data.timeline, rev: 0 } as T };
      const sent = body as typeof bodies[number];
      bodies.push(sent);
      return { ok: true, data: { released: sent.unused.length, taken: sent.named.length } as T };
    }, store);
    try {
      expect(await files.release()).toEqual({ ok: true, data: { released: 1000, taken: 500 } });
      expect(bodies).toHaveLength(2);
      for (const body of bodies) expect(new TextEncoder().encode(JSON.stringify(body)).length).toBeLessThan(100_000);
      expect(bodies.flatMap(({ unused }) => unused)).toEqual(held);
      expect(bodies.flatMap(({ named }) => named)).toEqual(named);
    } finally {
      walking.mockRestore();
    }
  });

  it('walks the pictures held by chats too, so an inlay is never taken for unused', async () => {
    const { store, files } = await server.account();
    const made = await importRisuChats(store, null, [{ title: 't', note: null, persona: null, greeting: 0, variables: [], inlays: [], messages: [{ role: 'user', text: 'hi', at: 1 }] }]);
    const chat = made.ok ? made.data[0]! : '';
    await server.hold(store, chat);
    expect(await fillPictures(store, files, { kind: 'inlay', parent: chat }, [{ name: 'a', read: async () => png() }])).toMatchObject({ ok: true, data: { unsupported: [] } });
    const later = Date.now() + 2 * 60 * 60 * 1000;
    const settled = vi.spyOn(Date, 'now').mockImplementation(() => later);
    try {
      expect(await files.release()).toEqual({ ok: true, data: { released: 0, taken: 0 } });
    } finally {
      settled.mockRestore();
    }
  });
});
