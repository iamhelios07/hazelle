import { unzipSync } from 'fflate';

const END_OF_DIRECTORY = 0x06054b50;
const END_RECORD = 22;

export type Zip = {
  // Whatever precedes the archive: the image of a JPEG with an appended zip.
  prefix: Uint8Array<ArrayBuffer>;
  read(path: string): Uint8Array<ArrayBuffer> | null;
};

// fflate reads the central directory with offsets from the start of the input, but a zip appended to a
// JPEG records them from its own start. The archive's start is where its directory says it must be.
export function openZip(bytes: Uint8Array): Zip | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const floor = Math.max(0, bytes.length - END_RECORD - 0xffff);
  let record = bytes.length - END_RECORD;
  while (record >= floor && view.getUint32(record, true) !== END_OF_DIRECTORY) record--;
  if (record < floor) return null;
  const start = record - view.getUint32(record + 12, true) - view.getUint32(record + 16, true);
  if (start < 0) return null;
  const archive = bytes.subarray(start);
  return {
    prefix: bytes.slice(0, start),
    // fflate writes every entry into a fresh ArrayBuffer (slc and inflateSync in 0.8.3); its types do not say so.
    read: (path) => (unzipSync(archive, { filter: (file) => file.name === path })[path] as Uint8Array<ArrayBuffer> | undefined) ?? null,
  };
}
