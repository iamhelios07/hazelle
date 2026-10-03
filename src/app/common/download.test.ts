import { afterEach, expect, it, vi } from 'vitest';
import { downloadOutput } from './download';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function temporaryStorage() {
  const files = new Map<string, { name: string; kind: 'file'; createWritable: () => Promise<typeof stream>; getFile: () => Promise<File> }>();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const stream = {
    write: vi.fn(async (chunk: Uint8Array<ArrayBuffer>) => { parts.push(chunk); }),
    close: vi.fn(async () => {}), abort: vi.fn(async () => {}),
  };
  const directory = {
    values: () => files.values(),
    getFileHandle: vi.fn(async (name: string) => {
      const handle = { name, kind: 'file' as const, createWritable: async () => stream, getFile: async () => new File(parts, name) };
      files.set(name, handle);
      return handle;
    }),
    removeEntry: vi.fn(async (name: string) => { files.delete(name); }),
  };
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => ({ getDirectoryHandle: async () => directory }) } });
  vi.stubGlobal('window', {});
  const click = vi.fn();
  vi.stubGlobal('document', { createElement: () => ({ click }) });
  return { directory, stream, click };
}

it('aborts and removes a temporary file without downloading', async () => {
  const { directory, stream, click } = temporaryStorage();
  const url = vi.spyOn(URL, 'createObjectURL');
  const output = await downloadOutput('backup.zip');
  await output.write(new Uint8Array([1]));
  await output.abort();
  expect(click).not.toHaveBeenCalled();
  expect(url).not.toHaveBeenCalled();
  expect(stream.abort).toHaveBeenCalledOnce();
  expect(directory.removeEntry).toHaveBeenCalledOnce();
});

it('opens the native picker synchronously and aborts its writable without closing it', async () => {
  const stream = { write: vi.fn(), close: vi.fn(), abort: vi.fn() };
  const picker = vi.fn(async () => ({ createWritable: async () => stream }));
  vi.stubGlobal('window', { showSaveFilePicker: picker });
  const pending = downloadOutput('backup.zip');
  expect(picker).toHaveBeenCalledOnce();
  const output = await pending;
  const chunk = new Uint8Array([1, 2, 3]);
  await output.write(chunk);
  await output.abort();
  expect(stream.write).toHaveBeenCalledWith(chunk);
  expect(stream.abort).toHaveBeenCalledOnce();
  expect(stream.close).not.toHaveBeenCalled();
});

it('writes through to disk and keeps the downloadable File until the next export starts', async () => {
  const { directory, stream, click } = temporaryStorage();
  const create = vi.spyOn(URL, 'createObjectURL');
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  const output = await downloadOutput('backup.zip');
  await output.write(new Uint8Array([1, 2]));
  await output.write(new Uint8Array([3]));
  expect(stream.write).toHaveBeenCalledTimes(2);
  expect(create).not.toHaveBeenCalled();
  await output.close();
  expect(click).toHaveBeenCalledOnce();
  expect(new Uint8Array(await (create.mock.calls[0]![0] as Blob).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  expect(directory.removeEntry).not.toHaveBeenCalled();
  expect(revoke).not.toHaveBeenCalled();
  const spool = directory.getFileHandle.mock.calls[0]![0];
  await downloadOutput('another.zip');
  expect(directory.removeEntry).toHaveBeenCalledExactlyOnceWith(spool);
  expect(revoke).toHaveBeenCalledExactlyOnceWith(create.mock.results[0]!.value);
});

it('holds the archive in memory where neither a picker nor a disk spool exists', async () => {
  vi.stubGlobal('window', {});
  vi.stubGlobal('navigator', { storage: {} });
  const click = vi.fn();
  vi.stubGlobal('document', { createElement: () => ({ click }) });
  const create = vi.spyOn(URL, 'createObjectURL');
  const output = await downloadOutput('backup.zip');
  await output.write(new Uint8Array([1, 2]));
  await output.close();
  expect(click).toHaveBeenCalledOnce();
  expect(new Uint8Array(await (create.mock.calls[0]![0] as Blob).arrayBuffer())).toEqual(new Uint8Array([1, 2]));
});
