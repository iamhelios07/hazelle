import { add, convert, convertModule, counted, type Converted, type Tally } from './convert';
import { UNSUPPORTED_KINDS, type ImportFailure, type ImportReport, type ImportResult, type Imported } from './types';
import { readPng } from './png';
import { readRisum } from './risum';
import { openZip, type Zip } from './zip';
import { isRecord } from '../../connectors/values';

const utf8 = new TextDecoder();
// The same one-liner as vault/aead.ts, which the engine may not import.
const base64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
const fail = (kind: ImportFailure['kind'], detail?: string): ImportResult => ({ ok: false, failure: detail ? { kind, detail } : { kind } });

// Dispatch goes by extension only, as in Risu; nothing is sniffed.
export function importCard(fileName: string, bytes: Uint8Array<ArrayBuffer>): ImportResult {
  const extension = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  try {
    switch (extension) {
      case 'png':
        return fromPng(bytes);
      case 'charx':
      case 'jpg':
      case 'jpeg':
        return fromCharx(bytes);
      case 'json':
        return fromJson(bytes);
      case 'risum':
        return fromRisum(bytes);
      default:
        return fail('unknown-format');
    }
  } catch (error) {
    return fail('unreadable', error instanceof Error ? error.message : String(error));
  }
}

function fromPng(bytes: Uint8Array<ArrayBuffer>): ImportResult {
  const png = readPng(bytes);
  if (!png) return fail('unreadable', 'not a PNG');
  if (!png.card) return fail('unreadable', 'the PNG holds no card');
  if (png.card.startsWith('rcc||')) return fail('encrypted');
  const tally: Tally = new Map();
  const converted = convert(JSON.parse(utf8.decode(base64(png.card))), null, tally);
  return converted ? done('png', converted, { bytes: png.image, type: 'image/png' }, { chunks: png.assets }, tally) : fail('unreadable', 'not a character card');
}

function fromCharx(bytes: Uint8Array<ArrayBuffer>): ImportResult {
  const zip = openZip(bytes);
  const card = zip?.read('card.json');
  if (!zip || !card) return fail('unreadable', 'no card.json');
  const tally: Tally = new Map();
  const moduleBytes = zip.read('module.risum');
  const module = moduleBytes ? (readRisum(moduleBytes)?.module ?? null) : null;
  if (moduleBytes && !module) add(tally, 'module');
  const converted = convert(JSON.parse(utf8.decode(card)), module, tally);
  return converted ? done('charx', converted, avatar(converted.icon, zip.prefix, zip, tally), { zip }, tally) : fail('unreadable', 'not a character card');
}

// A module file. Its pictures are the blocks after its main one, each for the entry of module.assets at its place.
function fromRisum(bytes: Uint8Array<ArrayBuffer>): ImportResult {
  const read = readRisum(bytes);
  if (!read) return fail('unreadable', 'not a module');
  const tally: Tally = new Map();
  const { assets: names, ...module } = convertModule(read.module, tally);
  add(tally, 'asset', Math.max(0, names.length - read.assets.length));
  const assets = read.assets.slice(0, names.length).map((block, index) => ({ name: names[index]!, read: async () => block() }));
  return { ok: true, module: { ...module, assets, unsupported: counted(UNSUPPORTED_KINDS, tally) } };
}

function fromJson(bytes: Uint8Array<ArrayBuffer>): ImportResult {
  const tally: Tally = new Map();
  const raw: unknown = JSON.parse(utf8.decode(bytes));
  // Risu's JSON export of a module, which names its pictures without holding them.
  if (isRecord(raw) && raw.type === 'risuModule') {
    const { assets, ...module } = convertModule(raw, tally);
    add(tally, 'asset', assets.length);
    return { ok: true, module: { ...module, assets: [], unsupported: counted(UNSUPPORTED_KINDS, tally) } };
  }
  const converted = convert(raw, null, tally);
  return converted ? done('json', converted, avatar(converted.icon, null, null, tally), {}, tally) : fail('unreadable', 'not a character card');
}

// Where a file's assets can be: a charx's zip, or a PNG's asset chunks.
type Holders = { zip?: Zip; chunks?: Map<string, string> };

function done(format: ImportReport['format'], converted: Converted, avatar: Imported['avatar'], holders: Holders, tally: Tally): ImportResult {
  const resolve: Resolve = (uri) => {
    const read = reader(uri, holders);
    if (!read) add(tally, 'asset');
    return read && (async () => read());
  };
  return { ok: true, card: { ...assemble(format, converted, resolve, tally), avatar } };
}

// Where an asset's bytes are read from; null for a uri the source does not hold, which the resolver counts.
export type Resolve = (uri: string) => Imported['assets'][number]['read'] | null;

// The report is counted after the assets are resolved, so the resolver's counts are in it.
export function assemble(format: ImportReport['format'], converted: Converted, resolve: Resolve, tally: Tally): Omit<Imported, 'avatar'> {
  const { card, lore, loreFolders, spec } = converted;
  const assets = converted.assets.flatMap(({ name, uri }) => {
    const read = resolve(uri);
    return read ? [{ name, read }] : [];
  });
  return { card, lore, loreFolders, assets, report: { format, spec, unsupported: counted(UNSUPPORTED_KINDS, tally) } };
}

// An asset's bytes as Risu finds them: __asset:N a PNG chunk, embeded:// (Risu's spelling) a file in the charx,
// data: inline. null for a uri none of them is, such as a web address.
function reader(uri: string, { zip, chunks }: Holders): (() => Uint8Array<ArrayBuffer> | null) | null {
  if (uri.startsWith('__asset:') && chunks) {
    const chunk = chunks.get(uri.slice('__asset:'.length));
    return () => (chunk === undefined ? null : decode(chunk));
  }
  if (uri.startsWith('embeded://') && zip) return () => zip.read(uri.slice('embeded://'.length));
  if (uri.startsWith('data:')) return () => dataUri(uri);
  return null;
}

function decode(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    return base64(text);
  } catch {
    return null;
  }
}

// CCv3's icon resolution: no icon or ccdefault: is the file's own image (the JPEG in front of a charx's zip),
// embeded:// (the spec's spelling) a file in the charx, data: an inline image, as Risu's JSON export writes it.
// An icon that cannot be read is counted as an asset.
function avatar(uri: string | null, own: Uint8Array<ArrayBuffer> | null, zip: Zip | null, tally: Tally): Imported['avatar'] {
  if (uri === null || uri === 'ccdefault:') return own?.length ? image(own, tally) : null;
  const bytes = uri.startsWith('embeded://') ? zip?.read(uri.slice('embeded://'.length)) : uri.startsWith('data:') ? dataUri(uri) : null;
  if (!bytes) {
    add(tally, 'asset');
    return null;
  }
  return image(bytes, tally);
}

function dataUri(uri: string): Uint8Array<ArrayBuffer> | null {
  const comma = uri.indexOf(',');
  if (comma === -1 || !uri.slice(0, comma).endsWith(';base64')) return null;
  return decode(uri.slice(comma + 1));
}

function image(bytes: Uint8Array<ArrayBuffer>, tally: Tally): Imported['avatar'] {
  const type = imageType(bytes);
  if (!type) {
    add(tally, 'asset');
    return null;
  }
  return { bytes, type };
}

// What picture the bytes are, read from them; null for anything else.
export function imageType(bytes: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 12) === 'ftypavif' || ascii(4, 12) === 'ftypavis') return 'image/avif';
  return null;
}
