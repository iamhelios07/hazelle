import { describe, expect, it } from 'vitest';
import { inlayType, readInlays } from '../../engine/import/backup';
import { INLAY_EXPORT } from './inlayExport';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 3]);

// IndexedDB as far as the export reaches into it: one open, one cursor over the store.
function indexedDB(items: [string, unknown][]) {
  const later = (run: () => void) => void Promise.resolve().then(run);
  const db = {
    close() {},
    transaction: () => ({ objectStore: () => ({ openCursor() {
      const request: { result: unknown; onsuccess?: () => void } = { result: null };
      let at = 0;
      const step = () => later(() => {
        const item = items[at];
        request.result = item ? { key: item[0], value: item[1], continue: () => { at++; step(); } } : null;
        request.onsuccess!();
      });
      step();
      return request;
    } }) }),
  };
  return { open() {
    const request: { result: unknown; onsuccess?: () => void } = { result: db };
    later(() => request.onsuccess!());
    return request;
  } };
}

describe('the inlay export', () => {
  it('writes the file the importer reads: pictures from a Blob or a data URL, signatures as JSON, video left out', async () => {
    const signature = { type: 'signature', data: 'sig', ext: 'json', name: 's' };
    const items: [string, unknown][] = [
      ['a', { type: 'image', data: new Blob([PNG]) }],
      ['b', { type: 'image', data: `data:image/jpeg;base64,${btoa(String.fromCharCode(...JPEG))}` }],
      ['v', { type: 'video', data: new Blob([PNG]) }],
      ['s', signature],
    ];
    let file: Blob | null = null;
    const page = { createElement: () => ({ click() {} }) };
    const url = { createObjectURL: (blob: Blob) => ((file = blob), 'blob:x'), revokeObjectURL() {} };
    await new Function('indexedDB', 'document', 'URL', 'alert', 'setTimeout', `return ${INLAY_EXPORT}`)(indexedDB(items), page, url, () => {}, () => {});

    const blob = file! as Blob;
    const inlays = await readInlays({ size: blob.size, read: async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()) });
    const read = await Promise.all(inlays!.assets(['a', 'b', 'v', 's', 'gone']).map(async ({ name, read }) => [name, await read()] as const));
    expect(read.slice(0, 2)).toEqual([['a', PNG], ['b', JPEG]]);
    expect(read.slice(2).map(([name, bytes]) => [name, bytes && inlayType(bytes)])).toEqual([['v', null], ['s', 'signature'], ['gone', null]]);
  });
});
