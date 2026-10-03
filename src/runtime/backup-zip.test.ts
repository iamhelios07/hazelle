import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { expect, it, vi } from 'vitest';
import { BackupZip, bufferedBackupOutput, indexZip, readEntry, type BackupOutput } from './backup-zip';

it('streams ZIP64 entries readable by the old unzipSync reader and indexes classic ZIP entries', async () => {
  const chunks: BlobPart[] = [];
  const output: BackupOutput = { write: async (bytes) => { chunks.push(bytes); }, close: async () => {}, abort: async () => {} };
  const signal = new AbortController().signal;
  const zip = new BackupZip(output, signal);
  const push = await zip.entry('objects.jsonl', true);
  await push(strToU8('hello\n'));
  await push(strToU8('world'), true);
  const picture = await zip.entry('files/picture', false);
  await picture(new Uint8Array([1, 2, 3]), true);
  await zip.end();
  const blob = new Blob(chunks);
  expect(strFromU8(unzipSync(new Uint8Array(await blob.arrayBuffer()))['objects.jsonl']!)).toBe('hello\nworld');
  const entries = await indexZip(blob, signal);
  expect(await readEntry(blob, entries.get('files/picture')!, signal)).toEqual(new Uint8Array([1, 2, 3]));
  const classic = new Blob([zipSync({ 'objects.jsonl': strToU8('old') })]);
  const old = await indexZip(classic, signal);
  expect(strFromU8(await readEntry(classic, old.get('objects.jsonl')!, signal))).toBe('old');
});

it('coalesces codec fragments into bounded acknowledged output pages and drops an aborted tail', async () => {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let release!: () => void;
  const close = vi.fn(async () => {});
  const abort = vi.fn(async () => {});
  const output = bufferedBackupOutput({
    write: async (bytes) => {
      chunks.push(bytes);
      if (chunks.length === 1) await new Promise<void>((resolve) => { release = resolve; });
    },
    close, abort,
  }, new AbortController().signal);
  const bytes = new Uint8Array(70000).fill(1);
  bytes.fill(2, 65536);
  const writing = output.write(bytes);
  await vi.waitFor(() => expect(chunks).toHaveLength(1), { interval: 1 });
  expect(chunks[0]).toHaveLength(65536);
  release();
  await writing;
  expect(chunks).toHaveLength(1);
  await output.close();
  expect(chunks[0]!.every((byte) => byte === 1)).toBe(true);
  expect(chunks[1]).toEqual(bytes.subarray(65536));
  expect(close).toHaveBeenCalledOnce();
  const write = vi.fn(async () => {});
  const stopped = bufferedBackupOutput({ write, close, abort }, new AbortController().signal);
  await stopped.write(new Uint8Array([3]));
  await stopped.abort();
  expect(write).not.toHaveBeenCalled();
  expect(abort).toHaveBeenCalledOnce();
});

it('does not complete a buffered destination stopped while its last page was writing', async () => {
  const stopped = new AbortController();
  const close = vi.fn(async () => {});
  const output = bufferedBackupOutput({ write: async () => stopped.abort(), close, abort: async () => {} }, stopped.signal);
  await output.write(new Uint8Array([1]));
  await expect(output.close()).rejects.toThrow();
  expect(close).not.toHaveBeenCalled();
  await output.abort();
});
