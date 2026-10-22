import { isRecord } from '../connectors/values';
import { FILE_ID, MAX_FILE_IDS, type MissingFiles } from '../contracts/files';
import { FILE_KINDS } from '../model/kinds';
import { fileId, openFile, sealFile, type FileRef } from '../vault/files';
import type { ApiFailure, ApiResult } from './api';
import type { Backend } from './backend';
import type { ObjectStore } from './store';

type Missing = Omit<MissingFiles, 'missing'> & { missing: Set<string> };

// How many transfers of stored files this page runs at once, reads and uploads together: over HTTP/1.1 a browser opens 6
// connections to a host, which the store and replies need too. runtime/api's SLOWEST_UPLOAD assumes the larger sharing
// one uplink.
export const TRANSFERS = { multiplexed: 24, http1: 4 } as const;
// What a run of transfers holds started and not yet taken (inOrder): a phone's memory sets it, not the speed.
export const HELD_AHEAD = 64 * 1024 * 1024;
const SWEEP_TRIES = 3;
const REFUSED = new Set(['too-large', 'file-blocked', 'files-full']);

// Plain http is always HTTP/1.1; behind https a browser that names no protocol is taken to multiplex.
export function transferSlots(protocol: string, nextHop: string | undefined): number {
  return protocol === 'https:' && nextHop !== 'http/1.1' ? TRANSFERS.multiplexed : TRANSFERS.http1;
}

// The page's one queue of transfers: each holds a slot until it ends, and the slot passes on at once, so a batch never
// waits on its slowest while the link idles. bulk: one of many (a backup, an import, an export), which a picture
// asked for on screen goes before.
export class Transfers {
  private running = 0;
  private readonly waiting = { now: [] as (() => void)[], bulk: [] as (() => void)[] };

  constructor(readonly slots: number) {}

  async run<T>(work: () => Promise<T>, bulk = false): Promise<T> {
    if (this.running < this.slots) this.running++;
    else await new Promise<void>((resolve) => this.waiting[bulk ? 'bulk' : 'now'].push(resolve));
    try {
      return await work();
    } finally {
      const next = this.waiting.now.shift() ?? this.waiting.bulk.shift();
      if (next) next();
      else this.running--;
    }
  }
}

const navigation = typeof performance === 'undefined' ? undefined : (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined);
export const transfers = new Transfers(transferSlots(globalThis.location?.protocol ?? '', navigation?.nextHopProtocol));

// Starts each item's transfer ahead of the one taken, up to ahead items and, where size tells them, HELD_AHEAD bytes
// started and not yet taken (the first always starts), and gives each with its result in order, as a zip or a check
// by position takes them. A caller that stops early still waits for those under way.
export async function* inOrder<T, R>(items: readonly T[], start: (item: T) => Promise<R>, { ahead = TRANSFERS.multiplexed, size = () => 0 }: { ahead?: number; size?: (item: T) => number } = {}): AsyncGenerator<[T, R]> {
  const started: Promise<R>[] = [];
  let next = 0;
  let held = 0;
  try {
    for (const item of items) {
      while (next < items.length && started.length < ahead && (started.length === 0 || held + size(items[next]!) <= HELD_AHEAD)) {
        held += size(items[next]!);
        const run = start(items[next++]!);
        // Awaited only once it is the head: one failing before then (a closed worker) must not read as unhandled.
        run.catch(() => {});
        started.push(run);
      }
      const result = await started.shift()!;
      held -= size(item);
      yield [item, result];
    }
  } finally {
    await Promise.allSettled(started);
  }
}

export const namedFile = (value: unknown): string | null => (isRecord(value) && isRecord(value.file) && typeof value.file.id === 'string' && FILE_ID.test(value.file.id) ? value.file.id : null);

// A file is sealed by its content, so one this account already holds is never sent again (accounts keep their own
// copies, src/server/files.ts); an import cut short and tried again sends only what did not arrive. Asking, uploading and reading wait out a
// dropped connection the way the store's calls do (store.reaching): a backup reads thousands of pictures in a row, and
// one dropped read must not end it. Every read and upload takes a slot of the page's transfers.
export class Files {
  private sweeping: Promise<void> | null = null;
  private owed = false;

  constructor(
    private readonly backend: Backend,
    private readonly store: ObjectStore,
    private readonly queue: Transfers = transfers,
  ) {}

  // Each file's reference, in order; null for one the server refuses: too large, blocked (taken down by the operator),
  // or past the account's picture cap, which the caller leaves out and counts as it does a picture it cannot read.
  async save(files: Uint8Array<ArrayBuffer>[], { signal, bulk }: { signal?: AbortSignal; bulk?: boolean } = {}): Promise<ApiResult<(FileRef | null)[]>> {
    if (signal?.aborted) return { ok: false, error: 'stopped' };
    const sealed = await Promise.all(files.map(sealFile));
    if (signal?.aborted) return { ok: false, error: 'stopped' };
    const bodies = new Map(sealed.map(({ ref, body }) => [ref.id, body]));
    const asked = await this.missing([...bodies.keys()]);
    if (!asked.ok) return asked;
    const refused = new Set<string>();
    const missing: string[] = [];
    let room = asked.data.room;
    for (const id of asked.data.missing) {
      const size = bodies.get(id)!.length;
      if (size > asked.data.maxBytes || (room !== null && size > room)) refused.add(id);
      else {
        missing.push(id);
        if (room !== null) room -= size;
      }
    }
    let failed: ApiFailure | undefined;
    await Promise.all(
      missing.map((id) =>
        this.queue.run(async () => {
          if (failed || signal?.aborted) return;
          const put = await this.store.reaching(() => this.backend.putFile(id, bodies.get(id)!), signal);
          if (put.ok) return;
          if (REFUSED.has(put.error)) refused.add(id);
          else failed ??= put;
        }, bulk),
      ),
    );
    if (signal?.aborted) return { ok: false, error: 'stopped' };
    if (failed) return failed;
    return { ok: true, data: sealed.map(({ ref }) => (refused.has(ref.id) ? null : ref)) };
  }

  // The ids the server holds no readable file for (never stored, or blocked), the largest sealed body it takes and the
  // bytes left under the account's picture cap.
  async missing(ids: string[]): Promise<ApiResult<Missing>> {
    const missing = new Set<string>();
    let maxBytes = 0;
    let room: number | null = null;
    for (let start = 0; start < ids.length; start += MAX_FILE_IDS) {
      const asked = await this.store.reaching(() => this.backend.missingFiles(ids.slice(start, start + MAX_FILE_IDS)));
      if (!asked.ok) return asked;
      for (const id of asked.data.missing) missing.add(id);
      ({ maxBytes, room } = asked.data);
    }
    return { ok: true, data: { missing, maxBytes, room } };
  }

  // Run after a removal for good (runtime/removal), and once more when another lands meanwhile. One that fails is left to
  // the next removal, and what it would have freed stays counted until then. A write landing mid-walk refuses it
  // (conflict), so a chat that goes on beside the removal walks again.
  sweep(): Promise<void> {
    this.owed = true;
    this.sweeping ??= (async () => {
      while (this.owed) {
        this.owed = false;
        for (let tries = 1; ; tries++) {
          const swept = await this.release();
          if (swept.ok || swept.error !== 'conflict' || tries === SWEEP_TRIES) break;
        }
      }
    })().finally(() => (this.sweeping = null));
    return this.sweeping;
  }

  // The files the account holds that no object names, 휴지통's included, are released, and the ones objects name that it
  // no longer holds are taken back (server/files.ts sweep). The walk must be whole: a row that does not open, or names no
  // file, ends the sweep with nothing released, since a picture only it named would be taken for unused. The held ids
  // are read before the walk, so a file uploaded during it is never weighed. The server checks the inventory's object
  // revision on its account queue: any object write during the walk invalidates its unused set.
  async release(signal?: AbortSignal): Promise<ApiResult<{ released: number; taken: number }>> {
    return this.store.pinned(async (pin): Promise<ApiResult<{ released: number; taken: number }>> => {
      const held: string[] = [];
      let rev: number | null = null;
      for (let more = true; more; ) {
        const after = held.at(-1);
        const page = await this.store.reaching(() => this.backend.heldFiles(after ?? null), signal);
        if (!page.ok) return page;
        if (page.data.timeline !== pin.timeline) return { ok: false, error: 'cache-reset' };
        if (rev !== null && rev !== page.data.rev) return { ok: false, error: 'conflict' };
        rev = page.data.rev;
        held.push(...page.data.ids);
        ({ more } = page.data);
      }
      const named = new Set<string>();
      let whole = true;
      for (const kind of FILE_KINDS) {
        const failure = await this.store.scan({ kind }, (_, value) => {
          const id = namedFile(value);
          if (id === null) whole = false;
          else named.add(id);
        }, pin, signal);
        if (failure) return failure;
        if (!whole) return { ok: false, error: 'unreadable' };
      }
      const holds = new Set(held);
      const unused = held.filter((id) => !named.has(id));
      const lost = [...named].filter((id) => !holds.has(id));
      const swept = { released: 0, taken: 0 };
      for (let start = 0; start < lost.length + unused.length; start += MAX_FILE_IDS) {
        const named = lost.slice(start, start + MAX_FILE_IDS);
        const released = unused.slice(Math.max(0, start - lost.length), Math.max(0, start + MAX_FILE_IDS - lost.length));
        // rev: set by the walk's first page, which always comes.
        const body = { timeline: pin.timeline, rev: rev!, unused: released, named };
        const answer = await this.store.reaching(() => this.backend.sweepFiles(body), signal);
        if (!answer.ok) return answer;
        swept.released += answer.data.released;
        swept.taken += answer.data.taken;
      }
      return { ok: true, data: swept };
    }, signal);
  }

  // A body sealed elsewhere, a share's manifest, stored as it is under its hash, as every file is. Its id.
  async put(body: Uint8Array<ArrayBuffer>): Promise<ApiResult<string>> {
    const id = await fileId(body);
    const put = await this.queue.run(() => this.store.reaching(() => this.backend.putFile(id, body)));
    return put.ok ? { ok: true, data: id } : put;
  }

  // A body that does not open answers 'unreadable', never empty bytes. The wait ends with signal (a backup's 중지), not
  // only with the store.
  async read(ref: FileRef, { signal, bulk }: { signal?: AbortSignal; bulk?: boolean } = {}): Promise<ApiResult<Uint8Array<ArrayBuffer>>> {
    const result = await this.queue.run(() => this.store.reaching(() => this.backend.readFile(ref.id), signal), bulk);
    if (!result.ok) return result;
    const bytes = await openFile(ref, result.data);
    return bytes ? { ok: true, data: bytes } : { ok: false, error: 'unreadable' };
  }
}

export const PERMANENT = new Set(['not-found', 'unreadable']);
