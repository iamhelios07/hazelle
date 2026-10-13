import { expect, it } from 'vitest';
import { droppedFiles } from './useFileDrop';

const file = (name: string) => ({ isFile: true, isDirectory: false, file: (done: (file: File) => void) => done(new File([name], name)) }) as unknown as FileSystemEntry;
// Hands its entries out in batches, as Chromium does 100 at a time, then an empty batch.
const folder = (...batches: FileSystemEntry[][]) =>
  ({ isFile: false, isDirectory: true, createReader: () => ({ readEntries: (done: (entries: FileSystemEntry[]) => void) => done(batches.shift() ?? []) }) }) as unknown as FileSystemEntry;

it('brings every file under a dropped folder, in its folders and across every batch the folder hands out', async () => {
  const dropped = await droppedFiles([new File(['a'], 'a.png'), folder([file('b.png'), folder([file('c.png')])], [file('d.png')])]);
  expect(dropped.map(({ name }) => name)).toEqual(['a.png', 'b.png', 'c.png', 'd.png']);
});
