import { Inflate, strFromU8, strToU8, ZipDeflate, ZipPassThrough } from 'fflate';

export type ZipEntry = { name: string; offset: number; compressed: number; size: number; method: number; crc: number };
export type BackupOutput = {
  write: (chunk: Uint8Array<ArrayBuffer>) => Promise<void>;
  close: () => Promise<void>;
  abort: () => Promise<void>;
};

const MAX32 = 0xffffffff;
const CHUNK = 64 * 1024;
// Codec output includes tiny fragments (and empty deflate flushes). A worker crosses to the host only with a bounded
// page, so awaiting a slow destination still bounds memory without one IPC/write per message.
export function bufferedBackupOutput(output: BackupOutput, signal: AbortSignal): BackupOutput {
  const buffer = new Uint8Array(CHUNK);
  let size = 0;
  const flush = async () => {
    signal.throwIfAborted();
    if (!size) return;
    const bytes = buffer.slice(0, size);
    size = 0;
    await output.write(bytes);
  };
  return {
    write: async (bytes) => {
      signal.throwIfAborted();
      for (let at = 0; at < bytes.length;) {
        const take = Math.min(buffer.length - size, bytes.length - at);
        buffer.set(bytes.subarray(at, at + take), size);
        size += take;
        at += take;
        if (size === buffer.length) await flush();
      }
    },
    close: async () => { await flush(); signal.throwIfAborted(); await output.close(); },
    abort: async () => { size = 0; await output.abort(); },
  };
}

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const u16 = (bytes: Uint8Array, at: number) => view(bytes).getUint16(at, true);
const u32 = (bytes: Uint8Array, at: number) => view(bytes).getUint32(at, true);
const u64 = (bytes: Uint8Array, at: number) => {
  const value = Number(view(bytes).getBigUint64(at, true));
  if (!Number.isSafeInteger(value)) throw new Error('ZIP offset is too large');
  return value;
};
const put16 = (bytes: Uint8Array, at: number, value: number) => view(bytes).setUint16(at, value, true);
const put32 = (bytes: Uint8Array, at: number, value: number) => view(bytes).setUint32(at, value, true);
const put64 = (bytes: Uint8Array, at: number, value: number) => view(bytes).setBigUint64(at, BigInt(value), true);

// fflate's Zip container truncates sizes/offsets to 32 bits. Its streaming entry classes also work
// with ZIP64 headers, so an account crossing 4 GiB must not silently become a corrupt archive.
export class BackupZip {
  private offset = 0;
  private readonly entries: ZipEntry[] = [];

  constructor(private readonly output: BackupOutput, private readonly signal: AbortSignal) {}

  private async write(bytes: Uint8Array<ArrayBuffer>) {
    this.signal.throwIfAborted();
    if (!bytes.length) return;
    await this.output.write(bytes);
    this.offset += bytes.length;
  }

  async entry(name: string, deflate: boolean) {
    const encoded = strToU8(name);
    const header = new Uint8Array(30 + encoded.length + 20);
    put32(header, 0, 0x04034b50);
    put16(header, 4, 45);
    put16(header, 6, 8);
    put16(header, 8, deflate ? 8 : 0);
    put16(header, 12, 33);
    put32(header, 18, MAX32);
    put32(header, 22, MAX32);
    put16(header, 26, encoded.length);
    put16(header, 28, 20);
    header.set(encoded, 30);
    put16(header, 30 + encoded.length, 1);
    put16(header, 32 + encoded.length, 16);
    const offset = this.offset;
    await this.write(header);
    const stream = deflate ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name);
    let chunks: Uint8Array<ArrayBuffer>[] = [];
    let compressed = 0;
    stream.ondata = (error, chunk) => {
      if (error) throw error;
      compressed += chunk.length;
      chunks.push(chunk);
    };
    return async (bytes: Uint8Array<ArrayBuffer>, final = false) => {
      for (let start = 0; start < bytes.length || (final && start === bytes.length); start += CHUNK) {
        this.signal.throwIfAborted();
        const end = Math.min(bytes.length, start + CHUNK);
        stream.push(bytes.subarray(start, end), final && end === bytes.length);
        for (const chunk of chunks) await this.write(chunk);
        chunks = [];
        if (end === bytes.length) break;
      }
      if (final) {
        const descriptor = new Uint8Array(24);
        put32(descriptor, 0, 0x08074b50);
        put32(descriptor, 4, stream.crc);
        put64(descriptor, 8, compressed);
        put64(descriptor, 16, stream.size);
        await this.write(descriptor);
        this.entries.push({ name, offset, compressed, size: stream.size, method: stream.compression, crc: stream.crc });
      }
    };
  }

  async end() {
    const start = this.offset;
    for (const entry of this.entries) {
      const name = strToU8(entry.name);
      const header = new Uint8Array(46 + name.length + 28);
      put32(header, 0, 0x02014b50);
      put16(header, 4, 45);
      put16(header, 6, 45);
      put16(header, 8, 8);
      put16(header, 10, entry.method);
      put16(header, 14, 33);
      put32(header, 16, entry.crc);
      put32(header, 20, MAX32);
      put32(header, 24, MAX32);
      put16(header, 28, name.length);
      put16(header, 30, 28);
      put32(header, 42, MAX32);
      header.set(name, 46);
      const extra = 46 + name.length;
      put16(header, extra, 1);
      put16(header, extra + 2, 24);
      put64(header, extra + 4, entry.size);
      put64(header, extra + 12, entry.compressed);
      put64(header, extra + 20, entry.offset);
      await this.write(header);
    }
    const end = this.offset;
    const footer = new Uint8Array(98);
    put32(footer, 0, 0x06064b50);
    put64(footer, 4, 44);
    put16(footer, 12, 45);
    put16(footer, 14, 45);
    put64(footer, 24, this.entries.length);
    put64(footer, 32, this.entries.length);
    put64(footer, 40, end - start);
    put64(footer, 48, start);
    put32(footer, 56, 0x07064b50);
    put64(footer, 64, end);
    put32(footer, 72, 1);
    put32(footer, 76, 0x06054b50);
    put16(footer, 84, 0xffff);
    put16(footer, 86, 0xffff);
    put32(footer, 88, MAX32);
    put32(footer, 92, MAX32);
    await this.write(footer);
  }
}

async function slice(file: Blob, offset: number, length: number, signal: AbortSignal) {
  signal.throwIfAborted();
  if (offset < 0 || length < 0 || offset + length > file.size) throw new Error('ZIP ends early');
  return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
}

export async function indexZip(file: Blob, signal: AbortSignal): Promise<Map<string, ZipEntry>> {
  const tail = await slice(file, Math.max(0, file.size - 65557), Math.min(file.size, 65557), signal);
  let end = tail.length - 22;
  while (end >= 0 && (u32(tail, end) !== 0x06054b50 || end + 22 + u16(tail, end + 20) !== tail.length)) end--;
  if (end < 0 || u32(tail, end + 4) !== 0) throw new Error('Not a single-disk ZIP');
  let count = u16(tail, end + 10);
  let offset = u32(tail, end + 16);
  let size = u32(tail, end + 12);
  if (count === 0xffff || offset === MAX32 || size === MAX32) {
    const locator = await slice(file, file.size - tail.length + end - 20, 20, signal);
    if (u32(locator, 0) !== 0x07064b50 || u32(locator, 4) !== 0 || u32(locator, 16) !== 1) throw new Error('Bad ZIP64 locator');
    const record = await slice(file, u64(locator, 8), 56, signal);
    if (u32(record, 0) !== 0x06064b50 || u32(record, 16) !== 0 || u32(record, 20) !== 0) throw new Error('Bad ZIP64 directory');
    count = u64(record, 32);
    size = u64(record, 40);
    offset = u64(record, 48);
  }
  const limit = offset + size;
  if (limit > file.size || count > size / 46) throw new Error('Bad ZIP directory');
  const entries = new Map<string, ZipEntry>();
  for (let i = 0; i < count; i++) {
    const header = await slice(file, offset, 46, signal);
    if (u32(header, 0) !== 0x02014b50 || (u16(header, 8) & 1) || u16(header, 34) !== 0) throw new Error('Bad ZIP entry');
    const method = u16(header, 10);
    if (method !== 0 && method !== 8) throw new Error('Unknown ZIP compression');
    const nameLength = u16(header, 28);
    const extraLength = u16(header, 30);
    const variable = await slice(file, offset + 46, nameLength + extraLength, signal);
    const name = strFromU8(variable.subarray(0, nameLength));
    let size = u32(header, 24);
    let compressed = u32(header, 20);
    let local = u32(header, 42);
    for (let at = nameLength; at + 4 <= variable.length; at += 4 + u16(variable, at + 2)) {
      if (u16(variable, at) !== 1) continue;
      let field = at + 4;
      if (size === MAX32) { size = u64(variable, field); field += 8; }
      if (compressed === MAX32) { compressed = u64(variable, field); field += 8; }
      if (local === MAX32) local = u64(variable, field);
      break;
    }
    if (entries.has(name) || size === MAX32 || compressed === MAX32 || local === MAX32) throw new Error('Bad ZIP entry');
    entries.set(name, { name, offset: local, size, compressed, method, crc: u32(header, 16) });
    offset += 46 + nameLength + extraLength + u16(header, 32);
  }
  if (offset !== limit) throw new Error('Bad ZIP directory size');
  return entries;
}

export async function* unzipEntry(file: Blob, entry: ZipEntry, signal: AbortSignal) {
  const header = await slice(file, entry.offset, 30, signal);
  if (u32(header, 0) !== 0x04034b50 || u16(header, 8) !== entry.method) throw new Error('Bad ZIP header');
  const start = entry.offset + 30 + u16(header, 26) + u16(header, 28);
  const checksum = new ZipPassThrough(entry.name);
  checksum.ondata = () => {};
  let chunks: Uint8Array<ArrayBuffer>[] = [];
  const inflate = entry.method === 8 ? new Inflate((chunk) => { chunks.push(chunk); }) : null;
  // A small compressed input bounds even a maximally expanding DEFLATE block to one page.
  const step = inflate ? 1024 : CHUNK;
  let size = 0;
  for (let at = 0; at < entry.compressed; at += CHUNK) {
    const bytes = await slice(file, start + at, Math.min(CHUNK, entry.compressed - at), signal);
    for (let offset = 0; offset < bytes.length; offset += step) {
      const part = bytes.subarray(offset, Math.min(offset + step, bytes.length));
      if (inflate) inflate.push(part, at + offset + part.length === entry.compressed);
      else chunks.push(part);
      for (const chunk of chunks) {
        size += chunk.length;
        if (size > entry.size) throw new Error('Bad ZIP size');
        checksum.push(chunk);
        yield chunk;
        signal.throwIfAborted();
      }
      chunks = [];
    }
  }
  checksum.push(new Uint8Array(), true);
  if (size !== entry.size || (checksum.crc >>> 0) !== entry.crc) throw new Error('Bad ZIP checksum');
}

export async function readEntry(file: Blob, entry: ZipEntry, signal: AbortSignal) {
  const bytes = new Uint8Array(entry.size);
  let at = 0;
  for await (const chunk of unzipEntry(file, entry, signal)) { bytes.set(chunk, at); at += chunk.length; }
  return bytes;
}
