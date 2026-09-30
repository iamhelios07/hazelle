import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped, type Zippable } from 'fflate';
import { isRecord } from '../connectors/values';
import { KINDS, isValue, type Kind, type Stored } from '../model/kinds';
import { SETTINGS_ID } from '../model/settings';
import type { ApiResult } from './api';
import type { FileRef } from '../vault/files';
import type { Files } from './files';
import { FIRST_ID } from './personas';
import { FIRST_PROFILE_ID } from './profiles';
import { STARTER_ID, TRANSLATOR_ID } from './prompts';
import type { ObjectStore, Write } from './store';

// version is the file format's one version key: a file of any other version is refused, never read as this one.
const FORMAT = { format: 'risu-alpha-backup', version: 2 };
const MANIFEST = 'manifest.json';
const OBJECTS = 'objects.jsonl';
const FILES = 'files/';
// Files are read, and sent back on a restore, this many at a time.
const FILE_WINDOW = 8;

// What opening an account adds by itself.
const SEEDED = new Set([STARTER_ID, TRANSLATOR_ID, FIRST_ID, FIRST_PROFILE_ID, SETTINGS_ID]);

const ALL = Object.keys(KINDS) as Kind[];
// The stored file an object names, for the kinds that name one.
const fileOf = ({ kind, value }: Stored<Kind>): FileRef | null => ('file' in KINDS[kind] ? (value as { file: FileRef }).file : null);

// files: each stored file's bytes, by its id.
export type Backup = { objects: Stored<Kind>[]; files: Map<string, Uint8Array<ArrayBuffer>> };
export type BackupFailure = { ok: false; error: 'not-backup' | 'other-version' };

// Every object the account reaches, decrypted, with the files they name, once each; connection keys are kept. Pieces
// nothing reaches are left out: a deleted chat's entries, and the lore and pictures of an
// import cut short. left counts the objects that did not open, which no backup can hold.
export async function exportBackup(store: ObjectStore, files: Files): Promise<ApiResult<{ zip: Uint8Array<ArrayBuffer>; left: number }>> {
  const objects = ALL.flatMap((kind) => store.list(kind)).filter(({ kind, parent }) => {
    const owner = KINDS[kind].parent;
    return owner === null || (parent !== null && store.get(owner, parent) !== null);
  });
  const zip: Zippable = {};
  const named = [...new Map(objects.flatMap((object) => fileOf(object) ?? []).map((ref) => [ref.id, ref])).values()];
  for (let start = 0; start < named.length; start += FILE_WINDOW) {
    const fetched = await Promise.all(named.slice(start, start + FILE_WINDOW).map(async (ref) => {
      const bytes = await files.read(ref);
      // Pictures are compressed already.
      if (bytes.ok) zip[FILES + ref.id] = [bytes.data, { level: 0 }];
      return bytes;
    }));
    const failure = fetched.find((result) => !result.ok);
    if (failure) return failure;
  }
  zip[MANIFEST] = strToU8(JSON.stringify(FORMAT));
  zip[OBJECTS] = strToU8(objects.map((object) => JSON.stringify(object)).join('\n'));
  return { ok: true, data: { zip: zipSync(zip), left: store.unreadable() } };
}

// The file comes from outside, so its shape and every body are checked before anything is written; one bad
// line refuses the whole file.
export function readBackup(bytes: Uint8Array): { ok: true; backup: Backup } | BackupFailure {
  const damaged = { ok: false, error: 'not-backup' } as const;
  let entries: Unzipped;
  try {
    entries = unzipSync(bytes);
  } catch {
    return damaged;
  }
  const text = (name: string) => entries[name] && strFromU8(entries[name]);
  const manifest = parse(text(MANIFEST));
  if (!isRecord(manifest) || manifest.format !== FORMAT.format) return damaged;
  if (manifest.version !== FORMAT.version) return { ok: false, error: 'other-version' };
  const lines = text(OBJECTS)?.split('\n');
  if (!lines) return damaged;
  const objects: Stored<Kind>[] = [];
  const held = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const line of lines) {
    const object = parse(line);
    if (!isStored(object)) return damaged;
    objects.push(object);
    const ref = fileOf(object);
    if (!ref) continue;
    // fflate writes every entry into a fresh ArrayBuffer; its types do not say so.
    const file = entries[FILES + ref.id] as Uint8Array<ArrayBuffer> | undefined;
    if (!file) return damaged;
    held.set(ref.id, file);
  }
  return { ok: true, backup: { objects, files: held } };
}

// A backup goes only into a new account: one holding nothing but what opening it added, and what this same
// backup already wrote, so loading the file again after a stop carries on from there.
// The backup's copies replace what opening added, and what it added that the backup lacks goes, so the
// account ends as the backup was.
export async function restoreBackup(store: ObjectStore, files: Files, backup: Backup, progress: (done: number, total: number) => void): Promise<ApiResult<null> | { ok: false; error: 'not-new' }> {
  const ids = new Set(backup.objects.map(({ id }) => id));
  const present = new Set(ALL.flatMap((kind) => store.list(kind)).map(({ id }) => id));
  if ([...present].some((id) => !ids.has(id) && !SEEDED.has(id))) return { ok: false, error: 'not-new' };

  const todo = backup.objects.filter(({ id }) => SEEDED.has(id) || !present.has(id));
  const held = [...backup.files.values()];
  const total = held.length + todo.length;
  let done = 0;
  // Each file seals to the id its objects name, and one the server holds already is not sent again.
  for (let start = 0; start < held.length; start += FILE_WINDOW) {
    const saved = await files.save(held.slice(start, start + FILE_WINDOW));
    if (!saved.ok) return saved;
    done += saved.data.length;
    progress(done, total);
  }
  // In their old rev order, so each chat's entries fold as they did.
  const writes = todo.sort((a, b) => a.rev - b.rev).map((object): Write => ({ ...object, type: 'restore' }));
  const restored = await store.batch(writes, () => progress(++done, total));
  if (!restored.ok) return restored;
  return store.batch([...SEEDED].filter((id) => !ids.has(id)).map((id) => ({ type: 'remove', id })));
}

function parse(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isStored(line: unknown): line is Stored<Kind> {
  return (
    isRecord(line) &&
    typeof line.kind === 'string' &&
    Object.hasOwn(KINDS, line.kind) &&
    typeof line.id === 'string' &&
    (line.parent === null || typeof line.parent === 'string') &&
    typeof line.rev === 'number' &&
    isValue(line.kind as Kind, line.value)
  );
}
