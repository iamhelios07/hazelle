import { inflate } from './inflate';

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const END_RECORD = 22;
const STORED = 0;
const DEFLATED = 8;

export type Zip = {
  // Whatever precedes the archive: the image of a JPEG with an appended zip.
  prefix: Uint8Array<ArrayBuffer>;
  // A file's bytes, read when asked, so a bot of thousands of pictures is never unpacked at once. null: no such
  // file, a damaged one, or one stored in a way this reader does not take.
  read(path: string): Uint8Array<ArrayBuffer> | null;
};

type Entry = { method: number; compressed: number; size: number; header: number };

const utf8 = new TextDecoder();

// The central directory is read once. A zip appended to a JPEG records its offsets from its own start, so the
// archive's start is where its directory says it must be.
export function openZip(bytes: Uint8Array<ArrayBuffer>): Zip | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const floor = Math.max(0, bytes.length - END_RECORD - 0xffff);
  let record = bytes.length - END_RECORD;
  while (record >= floor && view.getUint32(record, true) !== END_OF_DIRECTORY) record--;
  if (record < floor) return null;
  const directorySize = view.getUint32(record + 12, true);
  const start = record - view.getUint32(record + 16, true) - directorySize;
  if (start < 0) return null;
  const entries = new Map<string, Entry>();
  for (let at = record - directorySize; at + 46 <= record && view.getUint32(at, true) === DIRECTORY_ENTRY; ) {
    const nameLength = view.getUint16(at + 28, true);
    const name = utf8.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    entries.set(name, {
      method: view.getUint16(at + 10, true),
      compressed: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      header: start + view.getUint32(at + 42, true),
    });
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return {
    prefix: bytes.slice(0, start),
    read: (path) => {
      const entry = entries.get(path);
      if (!entry || entry.header + 30 > bytes.length || view.getUint32(entry.header, true) !== LOCAL_HEADER) return null;
      const from = entry.header + 30 + view.getUint16(entry.header + 26, true) + view.getUint16(entry.header + 28, true);
      const data = bytes.subarray(from, from + entry.compressed);
      if (entry.method === STORED) return data;
      if (entry.method !== DEFLATED) return null;
      try {
        return inflate(data, entry.size);
      } catch {
        return null;
      }
    },
  };
}
