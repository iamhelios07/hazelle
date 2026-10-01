import { gunzipSync } from 'fflate';
import { isRecord, list } from '../../connectors/values';
import { add, counted, type Tally } from './convert';
import { readMsgpack } from './msgpack';
import { convertPreset } from './preset';
import { picture, risuCharacter, type Entry, type Read } from './risu-character';
import {
  MOVE_UNSUPPORTED_KINDS,
  type BackupFailure,
  type BackupResult,
  type BackupSource,
  type MoveUnsupportedKind,
  type RisuBackup,
  type RisuCharacter,
  type RisuPersona,
  type RisuPreset,
} from './types';

type Json = Record<string, unknown>;
type Span = { offset: number; length: number };
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
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const record = (value: unknown): Json => (isRecord(value) ? value : {});
const fail = (kind: BackupFailure['kind'], detail?: string): BackupResult => ({ ok: false, failure: detail ? { kind, detail } : { kind } });

// Only the database and the cold-storage entries are read here; a picture is read when it is asked for.
export async function readBackup(source: BackupSource): Promise<BackupResult> {
  try {
    const files = await index(readAhead(source));
    if (files.has('encryption.risudat')) return fail('encrypted');
    const database = files.get('database.risudat');
    if (!database) return fail('no-database');
    const db = decode(await source.read(database.offset, database.length));
    if (!isRecord(db)) return fail('unreadable', 'not a Risu database');
    return { ok: true, backup: await fromDatabase(db, source, files) };
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
async function index(source: BackupSource): Promise<Map<string, Span>> {
  const files = new Map<string, Span>();
  const take = (offset: number, length: number) => {
    if (offset + length > source.size) throw new Error('the file ends early');
    return source.read(offset, length);
  };
  for (let at = 0; at < source.size; ) {
    const nameLength = u32(await take(at, 4), 0);
    const head = await take(at + 4, nameLength + 4);
    const length = u32(head, nameLength);
    files.set(utf8.decode(head.subarray(0, nameLength)), { offset: at + 8 + nameLength, length });
    at += 8 + nameLength + length;
    if (at > source.size) throw new Error('the file ends early');
  }
  return files;
}

const u32 = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, true);

function decode(bytes: Uint8Array): unknown {
  if (DATABASE_HEADER.some((byte, i) => bytes[i] !== byte)) throw new Error('not a Risu database');
  return readMsgpack(gunzipSync(bytes.subarray(DATABASE_HEADER.length)));
}

async function fromDatabase(db: Json, source: BackupSource, files: Map<string, Span>): Promise<RisuBackup> {
  const reader = (span: Span): Read => () => source.read(span.offset, span.length);
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

  const unsupported: Tally<MoveUnsupportedKind> = new Map();
  const loaded = await Promise.all(list(db.characters).map(async (stub): Promise<RisuCharacter | null> => {
    if (!isRecord(stub) || text(stub.chaId).startsWith('§')) return null;
    const char = typeof stub.coldstorage === 'string' ? await coldCharacter(stub, stub.coldstorage, cold) : stub;
    if (!char) {
      add(unsupported, 'cold-missing');
      return null;
    }
    if (typeof char.trashTime === 'number') return null;
    if (char.type === 'group') {
      add(unsupported, 'group-chat', list(char.chats).filter((chat) => list(record(chat).message).length > 0).length);
      return null;
    }
    const chats = await Promise.all(list(char.chats).map((chat) => coldChat(record(chat), cold)));
    return risuCharacter(char, chats, folders.get(text(char.chaId)) ?? null, entry);
  }));
  const characters = loaded.filter((char) => char !== null);
  characters.sort((a, b) => (order.get(a.id) ?? order.size) - (order.get(b.id) ?? order.size));
  add(unsupported, 'module', list(db.modules).length);

  // Risu builds one persona from the live values when the list is absent (setDatabase).
  const selected = typeof db.selectedPersona === 'number' ? db.selectedPersona : 0;
  const personas = (Array.isArray(db.personas) ? db.personas : [{}]).flatMap((raw, index): RisuPersona[] => {
    if (!isRecord(raw)) return [];
    // The selected persona's live copy is the database's top level (spec §5).
    const persona = index === selected ? { ...raw, name: db.username, icon: db.userIcon, personaPrompt: db.personaPrompt } : raw;
    const icon = text(persona.icon) && entry(text(persona.icon));
    return [{ id: text(persona.id) || null, name: text(persona.name), description: text(persona.personaPrompt), picture: icon ? () => picture(icon) : () => Promise.resolve(null) }];
  });

  const presets = list(db.botPresets).flatMap((raw, index): RisuPreset[] =>
    isRecord(raw) ? [{ name: text(raw.name), result: convertPreset(index === db.botPresetsId ? live(raw, db) : raw) }] : [],
  );

  return { characters, personas, presets, unsupported: counted(MOVE_UNSUPPORTED_KINDS, unsupported) };
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
