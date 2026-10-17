import { Gunzip, Inflate } from 'fflate';
import { progressed } from '../progress';

// How much packed data each step takes. DEFLATE unpacks to at most 1032 times its size, so an output past the size
// declared for it is refused within one step of passing it.
const STEP = 64 * 1024;

// What packed bytes may unpack to, all together. The largest real ones unpack to 3.3 times their size (a charx of
// pictures) and 2.8 (a Risu backup's database); the floor is for small files of text.
export const EXPANSION = 16;
const FLOOR = 64 * 1024 * 1024;
export const expansionLimit = (packed: number) => packed * EXPANSION + FLOOR;

// What one file of a card's or module's text may hold (card.json, module.risum, a .risum's JSON); the largest real
// ones hold 1.2 MB.
export const METADATA_BYTES = 16_000_000;

// A file past a limit, refused before more of it is unpacked or parsed. The message is the import failure's detail.
export class TooLarge extends RangeError {
  constructor(message: 'expands-too-far' | 'entry-too-large') {
    super(message);
  }
}

// The output grows as it is made, in steps: the size a file declares for it is checked and never allocated. Throws
// when the output is not exactly that size, as for packed bytes that do not read, and stops once it passes limit.
function drain(stream: Inflate | Gunzip, packed: Uint8Array, size: number, limit: number): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  stream.ondata = (chunk) => {
    total += chunk.length;
    if (total > size) throw new RangeError('more data than declared');
    if (total > limit) throw new TooLarge('expands-too-far');
    chunks.push(chunk);
  };
  for (let at = 0; at < packed.length; at += STEP) {
    stream.push(packed.subarray(at, at + STEP), at + STEP >= packed.length);
    progressed();
  }
  if (total !== size) throw new RangeError('less data than declared');
  return concat(chunks);
}

// A raw DEFLATE stream, as a ZIP entry holds one; size is what the archive's directory declares for its output, which
// openZip holds to the archive's limit.
export const inflate = (packed: Uint8Array, size: number) => drain(new Inflate(), packed, size, size);

// A gzip file, whose last four bytes declare its output's size; limit: what the caller lets it unpack to. The declared
// size alone does not refuse it, as a cut or damaged file declares whatever its last bytes hold.
export const gunzip = (file: Uint8Array, limit: number) =>
  drain(new Gunzip(), file, new DataView(file.buffer, file.byteOffset, file.byteLength).getUint32(file.length - 4, true), limit);

export function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
