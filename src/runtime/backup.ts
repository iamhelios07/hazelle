import { strFromU8, strToU8 } from 'fflate';
import { isRecord } from '../connectors/values';
import { KINDS, isValue, parentKinds, type Kind, type Stored } from '../model/kinds';
import { SETTINGS_ID } from '../model/settings';
import type { ApiFailure, ApiResult } from './api';
import { toBase64 } from '../vault/aead';
import type { FileRef } from '../vault/files';
import { BackupZip, indexZip, readEntry, unzipEntry, type BackupOutput, type ZipEntry } from './backup-zip';
import type { Files } from './files';
import { FIRST_ID } from './personas';
import { FIRST_PROFILE_ID } from './profiles';
import { MEMORY_PROMPT_ID, STARTER_ID, TRANSLATOR_ID } from './prompts';
import { SCOPED } from './object-cache';
import { ownershipDepth } from './removal';
import type { ObjectRow, ObjectStore, Pin, Write } from './store';

// version is the file format's one version key: a file of any other version is refused, never read as this one.
const FORMAT = { format: 'risu-alpha-backup', version: 2 };
const MANIFEST = 'manifest.json';
const OBJECTS = 'objects.jsonl';
const FILES = 'files/';
const PAGE_BYTES = 1024 * 1024;
const PAGE_ROWS = 128;
const HELD_BYTES = 8 * 1024 * 1024;

// What opening an account adds by itself.
const SEEDED = new Set([STARTER_ID, TRANSLATOR_ID, MEMORY_PROMPT_ID, FIRST_ID, FIRST_PROFILE_ID, SETTINGS_ID]);

const fileOf = ({ kind, value }: Stored<Kind>): FileRef | null => ('file' in KINDS[kind] ? (value as { file: FileRef }).file : null);

type Options = { signal?: AbortSignal; progress?: (done: number, total: number) => void };
export type Backup = { file: Blob; entries: Map<string, ZipEntry>; objects: ObjectRow[]; files: Map<string, FileRef> };
export type BackupFailure = { ok: false; error: 'not-backup' | 'other-version' | 'stopped' };
export type { BackupOutput } from './backup-zip';

// Every object the account reaches, decrypted, with the files they name, once each; connection keys are kept. Pieces
// nothing reaches are left out: a deleted chat's entries, and the lore and pictures of an
// import cut short. left counts the objects that did not open, which no backup can hold. skipped counts the objects
// naming a picture the operator blocked, which are left out as restore leaves out what the server refuses. Both scans
// are of one timeline: an account restored between them fails the export, and no archive is written.
export async function exportBackup(
  store: Pick<ObjectStore, 'scan' | 'pin'>,
  files: Pick<Files, 'read' | 'missing'>,
  output: BackupOutput,
  { signal = new AbortController().signal, progress = () => {} }: Options = {},
): Promise<ApiResult<{ left: number; skipped: number }>> {
  let complete = false;
  let refused: ApiFailure | null = null;
  try {
    const pinned = await store.pin(signal);
    if (!pinned.ok) return pinned;
    const pin = pinned.data;
    const metadata = new Map<string, ObjectRow>();
    const scanned = await store.scan({ metadata: true }, (row) => {
      signal.throwIfAborted();
      metadata.set(row.id, row);
    }, pin);
    if (scanned) return scanned;
    const reached = new Set<string>();
    let total = 0;
    for (const row of metadata.values()) {
      if (!Object.hasOwn(KINDS, row.kind)) continue;
      const kind = row.kind as Kind;
      const owners = parentKinds(kind);
      if (owners.length > 0 && (row.parent === null || !owners.some((owner) => owner === metadata.get(row.parent!)?.kind))) continue;
      reached.add(row.id);
      total += 1 + Number('file' in KINDS[kind]);
    }
    metadata.clear();
    let done = 0;
    let left = 0;
    progress(done, total);
    const zip = new BackupZip(output, signal);
    const manifest = await zip.entry(MANIFEST, false);
    await manifest(strToU8(JSON.stringify(FORMAT)), true);
    const objects = await zip.entry(OBJECTS, true);
    const named = new Map<string, { ref: FileRef; uses: number }>();
    const blocked = new Set<string>();
    let skipped = 0;
    let first = true;
    // readBackup refuses a line naming a file the archive lacks, so a blocked picture must be known before the first
    // line naming it is written. Lines are held from the first naming a picture not yet asked about, and the held
    // pictures are asked about together; only one the server does not hold is read early, to tell a block from a failure.
    let held: { line: string; ref: FileRef | null }[] = [];
    let heldBytes = 0;
    const unasked = new Map<string, FileRef>();
    const settle = async () => {
      if (unasked.size) {
        const missing = await files.missing([...unasked.keys()]);
        if (!missing.ok) throw (refused = missing);
        for (const id of missing.data) {
          const read = await files.read(unasked.get(id)!);
          if (!read.ok && read.error !== 'file-blocked') throw (refused = read);
          if (!read.ok) blocked.add(id);
        }
        unasked.clear();
      }
      for (const { line, ref } of held) {
        signal.throwIfAborted();
        if (ref && blocked.has(ref.id)) {
          skipped++;
          progress(done += 2, total);
          continue;
        }
        if (ref) named.set(ref.id, { ref, uses: (named.get(ref.id)?.uses ?? 0) + 1 });
        await objects(strToU8(`${first ? '' : '\n'}${line}`));
        first = false;
        progress(++done, total);
      }
      held = [];
      heldBytes = 0;
    };
    // An object edited elsewhere after it was written comes again later in the walk, at its newer rev. Each id is written
    // once, as first met, since the importer refuses a second line for an id and the first is already in the zip.
    const failure = await store.scan({}, async (row, value) => {
      signal.throwIfAborted();
      const due = reached.delete(row.id);
      if (value === undefined || !Object.hasOwn(KINDS, row.kind)) {
        left++;
        if (due) progress(done += 1 + Number('file' in KINDS[row.kind as Kind]), total);
        return;
      }
      if (!due) return;
      const object = { ...row, kind: row.kind as Kind, value } as Stored<Kind>;
      const ref = fileOf(object);
      if (ref && !named.has(ref.id) && !blocked.has(ref.id)) unasked.set(ref.id, ref);
      const line = JSON.stringify(object);
      held.push({ line, ref });
      heldBytes += line.length;
      if (!unasked.size || heldBytes > HELD_BYTES) await settle();
    }, pin);
    if (failure) return failure;
    await settle();
    await objects(new Uint8Array(), true);
    for (const { ref, uses } of named.values()) {
      signal.throwIfAborted();
      const bytes = await files.read(ref);
      if (!bytes.ok) return bytes;
      // Pictures are compressed already.
      const push = await zip.entry(FILES + ref.id, false);
      await push(bytes.data, true);
      progress(done += uses, total);
    }
    await zip.end();
    signal.throwIfAborted();
    await output.close();
    complete = true;
    return { ok: true, data: { left, skipped } };
  } catch {
    return refused ?? { ok: false, error: signal.aborted ? 'stopped' : 'backup-write' };
  } finally {
    if (!complete) await output.abort();
  }
}

// The file comes from outside, so its shape and every body are checked before anything is written; one bad
// line refuses the whole file. The index keeps metadata and references only, never decrypted bodies.
export async function readBackup(file: Blob, { signal = new AbortController().signal, progress = () => {} }: Options = {}): Promise<{ ok: true; backup: Backup } | BackupFailure> {
  try {
    const entries = await indexZip(file, signal);
    const manifestEntry = entries.get(MANIFEST);
    if (!manifestEntry || manifestEntry.size > 16384) return { ok: false, error: 'not-backup' };
    const manifest = parse(strFromU8(await readEntry(file, manifestEntry, signal)));
    if (!isRecord(manifest) || manifest.format !== FORMAT.format) return { ok: false, error: 'not-backup' };
    if (manifest.version !== FORMAT.version) return { ok: false, error: 'other-version' };
    const backup: Backup = { file, entries, objects: [], files: new Map() };
    const ids = new Set<string>();
    let rev = -Infinity;
    for await (const { object } of readObjects(backup, signal)) {
      // Both exporters walk the server's revision-ordered scan. Keeping that order on disk lets restore
      // replay each ownership depth without staging the whole JSONL in RAM or browser storage.
      if (object.rev < rev || ids.has(object.id)) return { ok: false, error: 'not-backup' };
      rev = object.rev;
      ids.add(object.id);
      const { id, kind, parent, rev: revision } = object;
      backup.objects.push({ id, kind, parent, rev: revision });
      const ref = fileOf(object);
      if (ref) {
        if (!entries.has(FILES + ref.id) || (backup.files.has(ref.id) && backup.files.get(ref.id)!.key !== ref.key)) return { ok: false, error: 'not-backup' };
        backup.files.set(ref.id, ref);
      }
    }
    progress(0, backup.objects.filter(({ kind }) => kind !== 'summary').length + backup.files.size);
    return { ok: true, backup };
  } catch {
    return { ok: false, error: signal.aborted ? 'stopped' : 'not-backup' };
  }
}

async function* readObjects(backup: Backup, signal: AbortSignal) {
  const entry = backup.entries.get(OBJECTS);
  if (!entry) throw new Error('Missing objects');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  const line = (text: string) => {
    const object = parse(text);
    if (!isStored(object) || !Number.isFinite(object.rev)) throw new Error('Bad object');
    return { object, size: text.length * 2 };
  };
  for await (const bytes of unzipEntry(backup.file, entry, signal)) {
    text += decoder.decode(bytes, { stream: true });
    let at = 0;
    let end: number;
    while ((end = text.indexOf('\n', at)) !== -1) {
      signal.throwIfAborted();
      yield line(text.slice(at, end));
      at = end + 1;
    }
    text = text.slice(at);
  }
  text += decoder.decode();
  if (text) yield line(text);
}

// A backup goes only into a new account: one holding nothing but what opening it added, and what this same
// backup already wrote, so loading the file again after a stop carries on from there.
// The backup's copies replace what opening added, whatever it holds now, and what it added that the backup lacks
// goes, so the account ends as the backup was. skipped: objects naming a picture the server refuses (taken down by
// the operator, or too large), which are left out. What is checked and what is written are of one timeline.
export function restoreBackup(store: Pick<ObjectStore, 'scan' | 'batch' | 'pinned'>, files: Pick<Files, 'save'>, backup: Backup, options: Options = {}): Promise<ApiResult<{ skipped: number }>> {
  return store.pinned((pin) => restoreOn(store, files, backup, options, pin), options.signal);
}

async function restoreOn(
  store: Pick<ObjectStore, 'scan' | 'batch'>,
  files: Pick<Files, 'save'>,
  backup: Backup,
  { signal = new AbortController().signal, progress = () => {} }: Options,
  pin: Pin,
): Promise<ApiResult<{ skipped: number }>> {
  try {
    const ids = new Set(backup.objects.filter(({ kind }) => kind !== 'summary').map(({ id }) => id));
    const present = new Set<string>();
    const failure = await store.scan({ metadata: true }, (row) => {
      signal.throwIfAborted();
      if (row.kind !== 'summary') present.add(row.id);
    }, pin);
    if (failure) return failure;
    if ([...present].some((id) => !ids.has(id) && !SEEDED.has(id))) return { ok: false, error: 'not-new' };
    // An id is not enough: another backup of the same account shares ids, and carrying on from its copies would mix
    // the two. What is there besides what opening added must be this backup's copy, as an earlier load wrote it.
    const kept = new Set([...present].filter((id) => !SEEDED.has(id)));
    if (kept.size) {
      const copies = new Map<string, string>();
      for await (const { object } of readObjects(backup, signal)) if (kept.has(object.id)) copies.set(object.id, await copyOf(object));
      let other = false;
      const failure = await store.scan({}, async (row, value) => {
        signal.throwIfAborted();
        if (copies.has(row.id) && copies.get(row.id) !== (await copyOf({ ...row, value }))) other = true;
      }, pin);
      if (failure) return failure;
      if (other) return { ok: false, error: 'not-new' };
    }
    const todo = new Set([...ids].filter((id) => SEEDED.has(id) || !present.has(id)));
    const total = backup.files.size + todo.size;
    let done = 0;
    progress(done, total);
    // Each file seals to the id its objects name, and one the server holds already is not sent again.
    // A file whose bytes were changed seals to another id, and an object's key may have been changed on its own: either
    // would restore a picture that never opens. All files are checked before the first object write.
    const refused = new Set<string>();
    for (const ref of backup.files.values()) {
      signal.throwIfAborted();
      const bytes = await readEntry(backup.file, backup.entries.get(FILES + ref.id)!, signal);
      signal.throwIfAborted();
      const saved = await files.save([bytes]);
      if (!saved.ok) return saved;
      const sealed = saved.data[0];
      if (!sealed) refused.add(ref.id);
      else if (sealed.id !== ref.id || sealed.key !== ref.key) return { ok: false, error: 'not-backup' };
      progress(++done, total);
    }
    let skipped = 0;
    // In their old rev order, so each chat's entries fold as they did; owners follow every owned page.
    const depths = [...new Set(backup.objects.filter(({ id }) => todo.has(id)).map(({ kind }) => ownershipDepth(kind as Kind)))].sort((a, b) => b - a);
    for (const depth of depths) {
      let writes: Write[] = [];
      let size = 0;
      const flush = async () => {
        const result = await store.batch(writes, () => progress(++done, total), { unheld: writes.every((write) => write.type !== 'remove' && SCOPED.has(write.kind)), signal });
        writes = [];
        size = 0;
        return result;
      };
      for await (const item of readObjects(backup, signal)) {
        if (!todo.has(item.object.id) || ownershipDepth(item.object.kind) !== depth) continue;
        const file = fileOf(item.object);
        if (file && refused.has(file.id)) {
          skipped++;
          progress(++done, total);
          continue;
        }
        if (writes.length && (writes.length === PAGE_ROWS || size + item.size > PAGE_BYTES)) {
          const result = await flush();
          if (!result.ok) return result;
        }
        writes.push({ ...item.object, type: 'restore' });
        size += item.size;
      }
      if (writes.length) {
        const result = await flush();
        if (!result.ok) return result;
      }
    }
    const removed = await store.batch([...SEEDED].filter((id) => !ids.has(id) && present.has(id)).map((id) => ({ type: 'remove', id })), undefined, { signal });
    return removed.ok ? { ok: true, data: { skipped } } : removed;
  } catch {
    return { ok: false, error: signal.aborted ? 'stopped' : 'not-backup' };
  }
}

async function copyOf({ kind, parent, value }: { kind: string; parent: string | null; value: unknown }): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', strToU8(JSON.stringify([kind, parent, value])));
  return toBase64(new Uint8Array(digest));
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
