import { add, cardSource, convert, counted, extensionOf, lorebookSource, record, text, type Converted, type Tally } from './convert';
import { hazelleSource, printOf, readHazelle, readModule, type ConvertedBundle } from './hazelle';
import { UNSUPPORTED_KINDS, type Bot, type Card, type ImportFailure, type ImportReport, type ImportResult, type Imported } from './types';
import { base64, readPng } from './png';
import { readPersona } from './persona';
import { readRisum, writeRisum } from './risum';
import { writeToggles } from './toggles';
import { openZip, type Zip } from './zip';
import { isRecord } from '../../connectors/values';

const utf8 = new TextDecoder();
const fail = (kind: ImportFailure['kind'], detail?: string): ImportResult => ({ ok: false, failure: detail ? { kind, detail } : { kind } });

export const blankCard = (name: string): Card => ({
  name, nickname: null, description: '', personality: '', scenario: '', greetings: [], exampleDialogue: '', systemPrompt: '', postHistoryInstructions: '',
  creatorNotes: '', creator: '', version: '', tags: [], variables: [], toggles: [], utility: false, bias: [], regex: [], triggers: [],
  loreSettings: { scanDepth: null, tokenBudget: null, recursive: null, fullWordMatching: null },
});

// Risu exports a module as a card named <name>.module.charx (modules.ts exportModule); a browser that already holds
// that name adds a count, as in "name.module(2).charx".
const MODULE_CHARX = /\.module\s*(?:\(\d+\)\s*)?\.charx$/i;

// Dispatch goes by extension only, as in Risu; nothing is sniffed.
export function importCard(fileName: string, bytes: Uint8Array<ArrayBuffer>): ImportResult {
  const extension = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  try {
    switch (extension) {
      case 'png':
        return fromPng(bytes);
      case 'charx':
        return MODULE_CHARX.test(fileName) ? fromModuleCharx(bytes) : fromCharx(bytes);
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
  if (!png.card) return png.persona === null ? fail('unreadable', 'the PNG holds no card') : readPersona(png.persona, png.image);
  if (png.card.startsWith('rcc||')) return fail('encrypted');
  const tally: Tally = new Map();
  const converted = convert(JSON.parse(utf8.decode(base64(png.card))), null, tally);
  return converted ? done('png', converted, { bytes: png.image, type: 'image/png' }, { chunks: png.assets }, tally, NOT_OWN) : fail('unreadable', 'not a character card');
}

function readCharx(bytes: Uint8Array<ArrayBuffer>, tally: Tally): { zip: Zip; raw: unknown; converted: Converted } | ImportResult {
  const zip = openZip(bytes);
  const card = zip?.read('card.json');
  if (!zip || !card) return fail('unreadable', 'no card.json');
  const moduleBytes = zip.read('module.risum');
  const module = moduleBytes ? (readRisum(moduleBytes)?.module ?? null) : null;
  if (moduleBytes && !module) add(tally, 'module');
  const raw: unknown = JSON.parse(utf8.decode(card));
  const converted = convert(raw, module, tally);
  return converted ? { zip, raw, converted } : fail('unreadable', 'not a character card');
}

function fromCharx(bytes: Uint8Array<ArrayBuffer>): ImportResult {
  const tally: Tally = new Map();
  const charx = readCharx(bytes, tally);
  if ('ok' in charx) return charx;
  const { zip, raw, converted } = charx;
  const extensions = record(record(record(raw).data).extensions);
  const { read, own, bundled } = readHazelle(extensions.hazelle, text(record(extensions.risuai).toggles), converted, tally);
  return done('charx', read, avatar(read.icon, zip.prefix, zip, tally), { zip }, tally, { own, bundled });
}

// Read as Risu reads it back: as a character, then convertCharacterToModule, where the creator notes are the module's
// description. The card's icon is the carrier's picture, not the module's.
function fromModuleCharx(bytes: Uint8Array<ArrayBuffer>): ImportResult {
  const tally: Tally = new Map();
  const charx = readCharx(bytes, tally);
  if ('ok' in charx) return charx;
  const { card, lore, loreFolders, assets } = charx.converted;
  const { regex, triggers, background, toggles } = card;
  const pack = { regex, triggers, ...(background === undefined ? {} : { background }), toggles };
  return { ok: true, module: { name: card.name, description: card.creatorNotes, namespace: null, risu: null, pack, lore, loreFolders, assets: located(assets, resolver({ zip: charx.zip }, tally)), unsupported: counted(UNSUPPORTED_KINDS, tally) } };
}

function fromRisum(bytes: Uint8Array<ArrayBuffer>): ImportResult {
  const read = readRisum(bytes);
  if (!read) return fail('unreadable', 'not a module');
  const tally: Tally = new Map();
  const { assets: names, ...module } = readModule(read.module, tally);
  add(tally, 'missing-asset', Math.max(0, names.length - read.assets.length));
  const assets = read.assets.slice(0, names.length).map((block, index) => ({ name: names[index]!, read: async () => block() }));
  return { ok: true, module: { ...module, assets, unsupported: counted(UNSUPPORTED_KINDS, tally) } };
}

function fromJson(bytes: Uint8Array<ArrayBuffer>): ImportResult {
  const tally: Tally = new Map();
  const raw: unknown = JSON.parse(utf8.decode(bytes));
  // Risu's JSON export of a module, which names its pictures without holding them.
  if (isRecord(raw) && raw.type === 'risuModule') {
    const { assets, ...module } = readModule(raw, tally);
    add(tally, 'missing-asset', assets.length);
    return { ok: true, module: { ...module, assets: [], unsupported: counted(UNSUPPORTED_KINDS, tally) } };
  }
  const converted = convert(raw, null, tally);
  return converted ? done('json', converted, avatar(converted.icon, null, null, tally), {}, tally, NOT_OWN) : fail('unreadable', 'not a character card');
}

type Holders = { zip?: Zip; chunks?: Map<string, string> };
type Owned = { own: Imported['own']; bundled: ConvertedBundle[] };
const NOT_OWN: Owned = { own: null, bundled: [] };

function done(format: ImportReport['format'], converted: Converted, avatar: Imported['avatar'], holders: Holders, tally: Tally, { own, bundled }: Owned): ImportResult {
  const resolve = resolver(holders, tally);
  const modules = bundled.map((module) => ({ ...module, assets: located(module.assets, resolve) }));
  return { ok: true, card: { ...assemble(format, converted, resolve, tally), avatar, own, bundled: modules } };
}

// Where an asset's bytes are read from; null for a uri the source does not hold, which the resolver counts.
export type Resolve = (uri: string) => Imported['assets'][number]['read'] | null;

const resolver = (holders: Holders, tally: Tally): Resolve => (uri) => {
  const read = reader(uri, holders);
  if (!read) add(tally, 'missing-asset');
  return read && (async () => read());
};

const located = (assets: Converted['assets'], resolve: Resolve): Imported['assets'] =>
  assets.flatMap(({ name, uri }) => {
    const read = resolve(uri);
    return read ? [{ name, read }] : [];
  });

// The report is counted after the assets are resolved, so the resolver's counts are in it.
export function assemble(format: ImportReport['format'], converted: Converted, resolve: Resolve, tally: Tally): Omit<Imported, 'avatar' | 'own' | 'bundled'> {
  const { card, lore, loreFolders, spec } = converted;
  const assets = located(converted.assets, resolve);
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
// An icon that cannot be read is counted as a missing asset, one that is not an image as not an image.
function avatar(uri: string | null, own: Uint8Array<ArrayBuffer> | null, zip: Zip | null, tally: Tally): Imported['avatar'] {
  if (uri === null || uri === 'ccdefault:') return own?.length ? image(own, tally) : null;
  const bytes = uri.startsWith('embeded://') ? zip?.read(uri.slice('embeded://'.length)) : uri.startsWith('data:') ? dataUri(uri) : null;
  if (!bytes) {
    add(tally, 'missing-asset');
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
    add(tally, 'not-image');
    return null;
  }
  return { bytes, type };
}

export function imageType(bytes: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 12) === 'ftypavif' || ascii(4, 12) === 'ftypavis') return 'image/avif';
  return null;
}

const utf8Out = new TextEncoder();

// The inverse of fromCharx: card.json and module.risum, and the paths the pictures go at, the avatar's first, then the
// assets' in the order bot lists them, the bundled modules' after the character's. Pictures are named by place, not by
// name, so no name needs making safe for a path; the card names each. The print is made by reading what is written.
export function writeCharx(bot: Bot): { files: { path: string; bytes: Uint8Array<ArrayBuffer> }[]; pictures: string[] } {
  const source = hazelleSource(bot);
  const icon = bot.avatar === null ? [] : [{ type: 'icon', name: 'main', ext: extensionOf(bot.avatar), uri: `embeded://assets/icon/image/main.${extensionOf(bot.avatar)}` }];
  const assets = [...icon, ...source.assets.map(({ name, type }, place) => ({ type: 'x-risu-asset', name, ext: extensionOf(type), uri: `embeded://assets/other/image/${place}.${extensionOf(type)}` }))];
  const module = writeRisum({ name: bot.card.name, description: '', regex: source.regex, trigger: source.triggers, lorebook: lorebookSource(source.lore, source.loreFolders) });
  const plain = utf8Out.encode(JSON.stringify(cardSource(bot.card, assets, {}, source.lua)));
  const read = convert(JSON.parse(utf8.decode(plain)), readRisum(module)!.module, new Map())!;
  const card = cardSource(bot.card, assets, { hazelle: { ...source.extension, print: printOf(read, writeToggles(bot.card.toggles)) } }, source.lua);
  return {
    files: [{ path: 'card.json', bytes: utf8Out.encode(JSON.stringify(card)) }, { path: 'module.risum', bytes: module }],
    pictures: assets.map(({ uri }) => uri.slice('embeded://'.length)),
  };
}
