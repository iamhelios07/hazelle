import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped, type Zippable } from 'fflate';
import { isRecord } from '../connectors/values';
import { KINDS, isValue, type Kind, type Stored } from '../model/kinds';
import { SETTINGS_ID } from '../model/settings';
import type { ApiResult } from './api';
import type { FileRef } from '../vault/files';
import type { Files } from './files';
import { FIRST_ID } from './personas';
import { FIRST_PROFILE_ID } from './profiles';
import { MEMORY_PROMPT_ID, STARTER_ID, TRANSLATOR_ID } from './prompts';
import type { ObjectStore, Write } from './store';

// version is the file format's one version key: a file of any other version is refused, never read as this one.
const FORMAT = { format: 'risu-alpha-backup', version: 2 };
const MANIFEST = 'manifest.json';
const OBJECTS = 'objects.jsonl';
const FILES = 'files/';
// Files are read, and sent back on a restore, this many at a time.
const FILE_WINDOW = 8;

// What opening an account adds by itself.
const SEEDED = new Set([STARTER_ID, TRANSLATOR_ID, MEMORY_PROMPT_ID, FIRST_ID, FIRST_PROFILE_ID, SETTINGS_ID]);

// The stored file an object names, for the kinds that name one.
const fileOf = ({ kind, value }: Stored<Kind>): FileRef | null => ('file' in KINDS[kind] ? (value as { file: FileRef }).file : null);

// files: each stored file's bytes, by its id.
export type Backup = { objects: Stored<Kind>[]; files: Map<string, Uint8Array<ArrayBuffer>> };
export type BackupFailure = { ok: false; error: 'not-backup' | 'other-version' };

// Every object the account reaches, decrypted, with the files they name, once each; connection keys are kept. Pieces
// nothing reaches are left out: a deleted chat's entries, and the lore and pictures of an
// import cut short. left counts the objects that did not open, which no backup can hold.
export async function exportBackup(store: ObjectStore, files: Files): Promise<ApiResult<{ zip: Uint8Array<ArrayBuffer>; left: number }>> {
  const scanned = new Map<string, Stored<Kind>>();
  let left = 0;
  const failure = await store.scan({}, (row, value) => {
    if (value === undefined || !Object.hasOwn(KINDS, row.kind)) { left++; return; }
    scanned.set(row.id, { ...row, kind: row.kind as Kind, value } as Stored<Kind>);
  });
  if (failure) return failure;
  const objects = [...scanned.values()].filter(({ kind, parent }) => {
    const owner = KINDS[kind].parent;
    return owner === null || (parent !== null && scanned.get(parent)?.kind === owner);
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
  return { ok: true, data: { zip: zipSync(zip), left } };
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
export async function restoreBackup(
  store: ObjectStore,
  files: Files,
  backup: Backup,
  progress: (done: number, total: number) => void,
): Promise<ApiResult<null> | { ok: false; error: 'not-new' | 'not-backup' }> {
  const ids = new Set(backup.objects.filter(({ kind }) => kind !== 'summary').map(({ id }) => id));
  const present = new Set<string>();
  const failure = await store.scan({ metadata: true }, (row) => { if (row.kind !== 'summary') present.add(row.id); });
  if (failure) return failure;
  if ([...present].some((id) => !ids.has(id) && !SEEDED.has(id))) return { ok: false, error: 'not-new' };

  const todo = backup.objects.filter(({ id, kind }) => kind !== 'summary' && (SEEDED.has(id) || !present.has(id)));
  const held = [...backup.files.values()];
  const total = held.length + todo.length;
  let done = 0;
  // Each file seals to the id its objects name, and one the server holds already is not sent again.
  const sealed = new Map<string, string>();
  for (let start = 0; start < held.length; start += FILE_WINDOW) {
    const saved = await files.save(held.slice(start, start + FILE_WINDOW));
    if (!saved.ok) return saved;
    for (const ref of saved.data) if (ref) sealed.set(ref.id, ref.key);
    done += saved.data.length;
    progress(done, total);
  }
  // A file whose bytes were changed seals to another id, and an object's key may have been changed on its own: either
  // would restore a picture that never opens.
  if (backup.objects.some((object) => { const ref = fileOf(object); return ref && sealed.get(ref.id) !== ref.key; })) return { ok: false, error: 'not-backup' };
  // In their old rev order, so each chat's entries fold as they did.
  const writes = todo.sort((a, b) => a.rev - b.rev).map((object): Write => ({ ...object, type: 'restore' }));
  const restored = await store.batch(writes, () => progress(++done, total));
  if (!restored.ok) return restored;
  return store.batch([...SEEDED].filter((id) => !ids.has(id) && present.has(id)).map((id) => ({ type: 'remove', id })));
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
