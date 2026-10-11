import { isRecord, list } from '../../connectors/values';
import { SIGNATURE } from '../assets';
import { imageType } from './card';
import { add, convertModule, counted, record, text, type Json, type Tally } from './convert';
import { gunzip } from './inflate';
import { readMsgpack } from './msgpack';
import { convertPreset } from './preset';
import { chatInfo, picture, risuCharacter, type Entry, type Read } from './risu-character';
import {
  MOVE_UNSUPPORTED_KINDS,
  UNSUPPORTED_KINDS,
  type BackupFailure,
  type BackupCatalog,
  type BackupResult,
  type BackupSource,
  type Imported,
  type ImportedModule,
  type MoveUnsupportedKind,
  type RisuBackup,
  type RisuPersona,
  type RisuPreset,
} from './types';

type Span = { source: BackupSource; offset: number; length: number };
type Cold = (key: string) => Promise<unknown>;

// 00 'RISUSAVE' 00 08, then gzip over msgpackr: the one form a backup's database is written in (spec §2).
const DATABASE_HEADER = [0, ...Array.from('RISUSAVE', (char) => char.charCodeAt(0)), 0, 8];
// coldstorageData.ts:4. The private-use marks are part of the pointer; the bare word is not one.
const COLD = 'COLDSTORAGE';
const READ_AHEAD = 4 * 1024 * 1024;
const COLD_READS = 8;
// A preset slot's keys and endpoints, never read (design F7).
const SECRETS = new Set(['openAIKey', 'proxyKey', 'forceReplaceUrl', 'forceReplaceUrl2', 'textgenWebUIStreamURL', 'textgenWebUIBlockingURL']);

const utf8 = new TextDecoder();
const fail = (kind: BackupFailure['kind'], detail?: string): BackupResult => ({ ok: false, failure: detail ? { kind, detail } : { kind } });

// Several files are read as one: the database comes from the first whose database is not encrypted, and every entry is
// looked up in all of them, that one first. So an account's full backup, whose database is locked with Risu's server key
// but whose pictures are plain, supplies the pictures beside the partial backup that supplies the text. Only the database
// and cold metadata are read here; histories are normalized only for a selected character, pictures only when asked.
export async function readBackup(sources: BackupSource[]): Promise<BackupResult> {
  try {
    const indexed = await Promise.all(sources.map((source) => index(readAhead(source), source)));
    const main = indexed.findIndex((files) => files.has('database.risudat') && !files.has('encryption.risudat'));
    if (main === -1) return fail(indexed.some((files) => files.has('encryption.risudat')) ? 'encrypted' : 'no-database');
    const files = new Map(indexed.flatMap((entries, at) => (at === main ? [] : [...entries])));
    for (const [name, span] of indexed[main]!) files.set(name, span);
    const database = files.get('database.risudat')!;
    const db = decode(await database.source.read(database.offset, database.length));
    if (!isRecord(db)) return fail('unreadable', 'not a Risu database');
    return { ok: true, backup: await fromDatabase(db, files) };
  } catch (error) {
    return fail('unreadable', error instanceof Error ? error.message : String(error));
  }
}

function readAhead(source: BackupSource): BackupSource {
  let start = 0;
  let bytes = new Uint8Array(0);
  return {
    size: source.size,
    async read(offset, length) {
      if (length > READ_AHEAD) return source.read(offset, length);
      if (offset < start || offset + length > start + bytes.length) {
        bytes = await source.read(offset, Math.min(READ_AHEAD, source.size - offset));
        start = offset;
      }
      return bytes.subarray(offset - start, offset - start + length);
    },
  };
}

// Records of u32 name length, name, u32 data length, data, little-endian, with nothing around them (spec §1).
// A span reads from the file it was indexed in, through raw: the read-ahead window serves one read at a time, and
// entries are read several at once.
async function index(source: BackupSource, raw: BackupSource): Promise<Map<string, Span>> {
  const files = new Map<string, Span>();
  const take = (offset: number, length: number) => {
    if (offset + length > source.size) throw new Error('the file ends early');
    return source.read(offset, length);
  };
  for (let at = 0; at < source.size; ) {
    const nameLength = u32(await take(at, 4), 0);
    const head = await take(at + 4, nameLength + 4);
    const length = u32(head, nameLength);
    files.set(utf8.decode(head.subarray(0, nameLength)), { source: raw, offset: at + 8 + nameLength, length });
    at += 8 + nameLength + length;
    if (at > source.size) throw new Error('the file ends early');
  }
  return files;
}

// The file the export run on the Risu page writes (app/library/inlayExport), in the backup's layout: inlay_<id> for
// each picture and Gemini signature (its stored item as JSON), and first of all inlay_skipped.json, naming the video and
// audio items left out, which marks the file as this export. null: another file.
export async function readInlays(source: BackupSource): Promise<Inlays | null> {
  const ahead = readAhead(source);
  if (source.size < 4) return null;
  const nameLength = u32(await ahead.read(0, 4), 0);
  if (4 + nameLength > source.size || utf8.decode(await ahead.read(4, nameLength)) !== INLAY_SKIPPED) return null;
  const files = await index(ahead, source);
  return {
    assets: (ids) => ids.map((id) => {
      const span = files.get(`${INLAY}${id}`);
      return { name: id, read: span ? () => span.source.read(span.offset, span.length) : () => Promise.resolve(null) };
    }),
  };
}

// assets: an entry per id, which reads null for one the file lacks.
// A backup can exceed memory; indexing reads slices, never an arrayBuffer of the whole archive.
export const fileSource = (file: File): BackupSource => ({
  size: file.size,
  read: async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()),
});

export type Inlays = { assets(ids: string[]): Imported['assets'] };

const INLAY = 'inlay_';
const INLAY_SKIPPED = `${INLAY}skipped.json`;

// A picture's type, or SIGNATURE for a Gemini thought signature's item; only an inlay is stored as either.
export function inlayType(bytes: Uint8Array): string | null {
  const type = imageType(bytes);
  if (type || bytes[0] !== 0x7b) return type;
  try {
    const item: unknown = JSON.parse(utf8.decode(bytes));
    return isRecord(item) && item.type === SIGNATURE ? SIGNATURE : null;
  } catch {
    return null;
  }
}

const u32 = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, true);

function decode(bytes: Uint8Array): unknown {
  if (DATABASE_HEADER.some((byte, i) => bytes[i] !== byte)) throw new Error('not a Risu database');
  return readMsgpack(gunzip(bytes.subarray(DATABASE_HEADER.length)));
}

const isPicture = (name: string) => name !== 'database.risudat' && name !== 'encryption.risudat' && !name.startsWith('coldstorage_');

async function fromDatabase(db: Json, files: Map<string, Span>): Promise<RisuBackup> {
  const reader = (span: Span): Read => () => span.source.read(span.offset, span.length);
  // An entry is named by the basename of its asset key (spec §7).
  const entry: Entry = (key) => {
    const span = files.get(key.slice(Math.max(key.lastIndexOf('/'), key.lastIndexOf('\\')) + 1));
    return span ? reader(span) : null;
  };
  let reading = 0;
  const waiting: (() => void)[] = [];
  // Character and chat payloads share the same limit, including chats inside a cold character.
  const cold: Cold = async (key) => {
    const span = files.get(`coldstorage_${key}.json`);
    if (!span) return null;
    if (reading === COLD_READS) await new Promise<void>((resolve) => waiting.push(resolve));
    else reading++;
    try {
      const bytes = await reader(span)();
      // A payload that does not parse is as missing as one the backup left out.
      try {
        return JSON.parse(utf8.decode(bytes));
      } catch {
        return null;
      }
    } finally {
      const next = waiting.shift();
      if (next) next();
      else reading--;
    }
  };

  const order = new Map<string, number>();
  const folders = new Map<string, string>();
  for (const item of list(db.characterOrder)) {
    for (const id of typeof item === 'string' ? [item] : list(record(item).data)) {
      if (typeof id !== 'string' || order.has(id)) continue;
      order.set(id, order.size);
      if (isRecord(item)) folders.set(id, text(item.name));
    }
  }

  const raw = list(db.characters);
  const load = async (key: number) => {
    const stub = raw[key] as Json;
    return typeof stub.coldstorage === 'string' ? coldCharacter(stub, stub.coldstorage, cold) : stub;
  };
  const unsupported: Tally<MoveUnsupportedKind> = new Map();
  const loaded = await Promise.all(raw.map(async (stub, key): Promise<BackupCatalog['characters'][number] | null> => {
    if (!isRecord(stub) || text(stub.chaId).startsWith('§')) return null;
    const char = await load(key);
    if (!char) {
      add(unsupported, 'cold-missing');
      return null;
    }
    if (typeof char.trashTime === 'number') return null;
    if (char.type === 'group') {
      add(unsupported, 'group-chat', list(char.chats).filter((chat) => list(record(chat).message).length > 0).length);
      return null;
    }
    // A cold payload may be needed for exact counts/order, but no unselected RisuChat or message text is kept.
    const chats = await Promise.all(list(char.chats).map(async (chat) => chatInfo(await coldChat(record(chat), cold))));
    const character = risuCharacter(char, [], folders.get(text(char.chaId)) ?? null, entry);
    return {
      key, id: character.id, name: character.card.name, assetCount: character.assets.length,
      chatCount: chats.filter((chat) => chat !== null).length,
      inlayCount: chats.reduce((sum, chat) => sum + (chat?.inlays ?? 0), 0),
      lastTalk: chats.reduce((latest, chat) => Math.max(latest, chat?.lastTalk ?? 0), 0),
    };
  }));
  const characters = loaded.filter((char) => char !== null);
  characters.sort((a, b) => (order.get(a.id) ?? order.size) - (order.get(b.id) ?? order.size));

  // Risu builds one persona from the live values when the list is absent (setDatabase).
  const selected = typeof db.selectedPersona === 'number' ? db.selectedPersona : 0;
  const personas = (Array.isArray(db.personas) ? db.personas : [{}]).flatMap((raw, index): RisuPersona[] => {
    if (!isRecord(raw)) return [];
    // The selected persona's live copy is the database's top level (spec §5).
    const persona = index === selected ? { ...raw, name: db.username, icon: db.userIcon, personaPrompt: db.personaPrompt } : raw;
    const icon = text(persona.icon) && entry(text(persona.icon));
    const module = isRecord(persona.embeddedModule) ? risuModule(persona.embeddedModule, entry) : null;
    return [{ id: text(persona.id) || null, name: text(persona.name), alias: text(persona.note).trim(), description: text(persona.personaPrompt), picture: icon ? () => picture(icon) : () => Promise.resolve(null), module }];
  });

  const presets = list(db.botPresets).flatMap((raw, index): RisuPreset[] =>
    isRecord(raw) ? [{ name: text(raw.name), result: convertPreset(index === db.botPresetsId ? live(raw, db) : raw) }] : [],
  );

  const modules = list(db.modules).filter(isRecord).map((raw) => risuModule(raw, entry));
  const alwaysModules = list(db.enabledModules).filter((id) => typeof id === 'string');

  const pictures = [...files.keys()].filter(isPicture).length;
  return {
    catalog: {
      pictures, characters,
      personas: personas.map(({ name, alias }, key) => ({ key, name, alias })),
      presets: presets.map(({ name, result }, key) => ({ key, name, failure: result.ok ? null : result.failure.kind })),
      modules: modules.map(({ name, risu, assets }, key) => ({ key, name, risu, assetCount: assets.length })),
      alwaysModules, unsupported: counted(MOVE_UNSUPPORTED_KINDS, unsupported),
    },
    async character(key) {
      const char = (await load(key))!;
      const chats = await Promise.all(list(char.chats).map((chat) => coldChat(record(chat), cold)));
      return risuCharacter(char, chats, folders.get(text(char.chaId)) ?? null, entry);
    },
    persona: async (key) => personas[key]!,
    preset: async (key) => presets[key]!,
    module: async (key) => modules[key]!,
  };
}

// A module's pictures are in the backup's asset storage, each under the key its entry of module.assets holds. One the
// backup lacks is counted as an asset the module names without holding, as for a module file.
function risuModule(raw: Json, entry: Entry): ImportedModule {
  const tally: Tally = new Map();
  const { assets: names, ...module } = convertModule(raw, tally);
  const assets = list(raw.assets).flatMap((asset, index) => {
    const key = Array.isArray(asset) ? text(asset[1]) : '';
    // Any key other than a Risu asset key points outside the backup.
    const read = key.startsWith('assets/') ? entry(key) : null;
    if (!read) add(tally, 'asset');
    return read ? [{ name: names[index]!, read }] : [];
  });
  return { ...module, assets, unsupported: counted(UNSUPPORTED_KINDS, tally) };
}

// Classed by the payload's type: a stub says 'character' even for a group.
async function coldCharacter(stub: Json, key: string, cold: Cold): Promise<Json | null> {
  const payload = await cold(key);
  const char = isRecord(payload) ? payload.character : null;
  return isRecord(char) && char.chaId === stub.chaId ? char : null;
}

// A chat whose messages Risu moved out leaves one message holding the pointer; null when the backup lacks them.
// lastDate stays the chat's own, where Risu's rehydration sets it to now.
async function coldChat(chat: Json, cold: Cold): Promise<Json | null> {
  const pointer = text(record(list(chat.message)[0]).data);
  if (!pointer.startsWith(COLD)) return chat;
  const payload = await cold(pointer.slice(COLD.length));
  // An older payload is the message list alone.
  if (Array.isArray(payload)) return { ...chat, message: payload };
  if (!isRecord(payload) || !Array.isArray(payload.message)) return null;
  const { message, hypaV2Data, hypaV3Data, scriptstate, localLore } = payload;
  return { ...chat, message, hypaV2Data, hypaV3Data, scriptstate, localLore };
}

// The active slot's values live at the database's top level until Risu saves the preset (saveCurrentPreset): each
// key the slot holds is taken from there, regex from presetRegex. Its name and picture stay the slot's.
function live(slot: Json, db: Json): Json {
  return Object.fromEntries(
    Object.entries(slot).flatMap(([key, value]) => {
      if (SECRETS.has(key)) return [];
      if (key === 'name' || key === 'image') return [[key, value]];
      return [[key, db[key === 'regex' ? 'presetRegex' : key]]];
    }),
  );
}
