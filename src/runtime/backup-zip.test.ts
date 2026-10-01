import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { expect, it } from 'vitest';
import { BackupZip, indexZip, readEntry, type BackupOutput } from './backup-zip';

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
