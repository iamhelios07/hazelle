import { Gunzip, Inflate } from 'fflate';

// How much packed data each step takes. DEFLATE unpacks to at most 1032 times its size, so an output past the size
// declared for it is refused within one step of passing it.
const STEP = 64 * 1024;

// The output grows as it is made, in steps: the size a file declares for it is checked and never allocated, since a
// few bytes can declare 4 GB. Throws when the output is not exactly that size, as for packed bytes that do not read.
function drain(stream: Inflate | Gunzip, packed: Uint8Array, size: number): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  stream.ondata = (chunk) => {
    total += chunk.length;
    if (total > size) throw new RangeError('more data than declared');
    chunks.push(chunk);
  };
  for (let at = 0; at < packed.length; at += STEP) stream.push(packed.subarray(at, at + STEP), at + STEP >= packed.length);
  if (total !== size) throw new RangeError('less data than declared');
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

// A raw DEFLATE stream, as a ZIP entry holds one; size is what the archive's directory declares for its output.
export const inflate = (packed: Uint8Array, size: number) => drain(new Inflate(), packed, size);

// A gzip file, whose last four bytes declare its output's size.
export function gunzip(file: Uint8Array): Uint8Array<ArrayBuffer> {
  return drain(new Gunzip(), file, new DataView(file.buffer, file.byteOffset, file.byteLength).getUint32(file.length - 4, true));
}
