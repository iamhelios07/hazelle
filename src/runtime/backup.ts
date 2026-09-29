import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped, type Zippable } from 'fflate';
import { isRecord } from '../connectors/values';
import { KINDS, type Kind, type Stored } from '../model/kinds';
import { SETTINGS_ID } from '../model/settings';
import type { ApiFailure, ApiResult } from './api';
import type { Files } from './files';
import { FIRST_ID } from './personas';
import { FIRST_PROFILE_ID } from './profiles';
import { STARTER_ID } from './prompts';
import type { ObjectStore } from './store';

// version is the file format's one version key: a file of any other version is refused, never read as this one.
const FORMAT = { format: 'risu-alpha-backup', version: 1 };
const MANIFEST = 'manifest.json';
const OBJECTS = 'objects.jsonl';
const FILES = 'files/';

// Files are fetched and objects written this many at a time, one request each.
const PARALLEL = 8;

// What opening an account adds by itself.
const SEEDED = new Set([STARTER_ID, FIRST_ID, FIRST_PROFILE_ID, SETTINGS_ID]);

const ALL = Object.keys(KINDS) as Kind[];
const holdsFile = (kind: Kind) => 'file' in KINDS[kind];

export type Backup = { objects: Stored<Kind>[]; files: Map<string, Uint8Array<ArrayBuffer>> };
export type BackupFailure = { ok: false; error: 'not-backup' | 'other-version' };

// Every object the account reaches, decrypted, with the file each holds; connection keys are kept. Pieces
// nothing reaches are left out: a deleted chat's entries, and the lore and picture of an
// import cut short. left counts the objects that did not open, which no backup can hold.
export async function exportBackup(store: ObjectStore, files: Files): Promise<ApiResult<{ zip: Uint8Array<ArrayBuffer>; left: number }>> {
  const objects = ALL.flatMap((kind) => store.list(kind)).filter(({ kind, parent }) => {
    const owner = KINDS[kind].parent;
    return owner === null || (parent !== null && store.get(owner, parent) !== null);
  });
  const zip: Zippable = {};
  const fetched = await inLanes(
    objects
      .filter(({ kind }) => holdsFile(kind))
      .map(({ id }) => [
        async () => {
          const bytes = await files.get(id);
          // Pictures are compressed already.
          if (bytes.ok) zip[FILES + id] = [bytes.data, { level: 0 }];
          return bytes;
        },
      ]),
  );
  if (fetched) return fetched;
  zip[MANIFEST] = strToU8(JSON.stringify(FORMAT));
  zip[OBJECTS] = strToU8(objects.map((object) => JSON.stringify(object)).join('\n'));
  return { ok: true, data: { zip: zipSync(zip), left: store.unreadable() } };
}

// The file comes from outside, so its shape is checked before anything is written. Values are taken as
// the export wrote them.
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
    if (!holdsFile(object.kind)) continue;
    // fflate writes every entry into a fresh ArrayBuffer; its types do not say so.
    const file = entries[FILES + object.id] as Uint8Array<ArrayBuffer> | undefined;
    if (!file) return damaged;
    held.set(object.id, file);
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
  let done = 0;
  const write = (object: Stored<Kind>) => async () => {
    const file = backup.files.get(object.id);
    if (file) {
      const put = await files.put(object.id, file);
      if (!put.ok) return put;
    }
    const written = await store.restore(object);
    if (written.ok) progress(++done, todo.length);
    return written;
  };
  // Owned objects go first, so an owner shows up whole. A chat's entries go one after another in their old
  // order, since each write takes the account's next rev and model/chat fold reads them in rev order.
  const owned: (() => Promise<ApiResult<unknown>>)[][] = [];
  const entries = new Map<string, Stored<Kind>[]>();
  const owners: (() => Promise<ApiResult<unknown>>)[][] = [];
  for (const object of todo) {
    if (KINDS[object.kind].parent === null) owners.push([write(object)]);
    else if (object.kind !== 'entry') owned.push([write(object)]);
    else {
      const chat = entries.get(object.parent!) ?? [];
      chat.push(object);
      entries.set(object.parent!, chat);
    }
  }
  for (const chat of entries.values()) owned.push(chat.sort((a, b) => a.rev - b.rev).map(write));
  const failure = (await inLanes(owned)) ?? (await inLanes(owners));
  if (failure) return failure;
  for (const id of SEEDED) {
    if (ids.has(id)) continue;
    const removed = await store.remove(id);
    if (!removed.ok) return removed;
  }
  return { ok: true, data: null };
}

// Runs the lanes PARALLEL at a time, each lane's steps in order. The first failure stops every lane
// before its next step.
async function inLanes(lanes: (() => Promise<ApiResult<unknown>>)[][]): Promise<ApiFailure | null> {
  let next = 0;
  let failure: ApiFailure | null = null;
  const worker = async () => {
    while (next < lanes.length) {
      for (const step of lanes[next++]!) {
        if (failure) return;
        const result = await step();
        if (!result.ok) failure ??= result;
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return failure;
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
    isRecord(line.value)
  );
}
