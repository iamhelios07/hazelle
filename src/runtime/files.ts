import { isRecord } from '../connectors/values';
import { FILE_ID, MAX_FILE_IDS } from '../contracts/files';
import { FILE_KINDS } from '../model/kinds';
import { fileId, openFile, sealFile, type FileRef } from '../vault/files';
import type { ApiFailure, ApiResult, api as realApi } from './api';
import type { ObjectStore } from './store';

type Api = typeof realApi;
type Missing = { missing: Set<string>; maxBytes: number; room: number | null };

// runtime/api's SLOWEST_UPLOAD assumes this many uploads sharing one uplink.
const UPLOADS = 24;
const SWEEP_TRIES = 3;
const REFUSED = new Set(['too-large', 'file-blocked', 'files-full']);

export const namedFile = (value: unknown): string | null => (isRecord(value) && isRecord(value.file) && typeof value.file.id === 'string' && FILE_ID.test(value.file.id) ? value.file.id : null);

// A file is sealed by its content, so one this account already holds is never sent again (accounts keep their own
// copies, src/server/files.ts); an import cut short and tried again sends only what did not arrive. Asking, uploading and reading wait out a
// dropped connection the way the store's calls do (store.reaching): a backup reads thousands of pictures in a row, and
// one dropped read must not end it.
export class Files {
  private sweeping: Promise<void> | null = null;
  private owed = false;
  private uploading = 0;
  private readonly queued: (() => void)[] = [];

  constructor(
    private readonly request: Api,
    private readonly store: ObjectStore,
  ) {}

  // Each file's reference, in order; null for one the server refuses: too large, blocked (taken down by the operator),
  // or past the account's picture cap, which the caller leaves out and counts as it does a picture it cannot read.
  async save(files: Uint8Array<ArrayBuffer>[], { signal }: { signal?: AbortSignal } = {}): Promise<ApiResult<(FileRef | null)[]>> {
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
        this.uploadSlot(async () => {
          if (failed || signal?.aborted) return;
          const put = await this.store.reaching(() => this.request('PUT', `files/${id}`, bodies.get(id)!), signal);
          if (put.ok) return;
          if (REFUSED.has(put.error)) refused.add(id);
          else failed ??= put;
        }),
      ),
    );
    if (signal?.aborted) return { ok: false, error: 'stopped' };
    if (failed) return failed;
    return { ok: true, data: sealed.map(({ ref }) => (refused.has(ref.id) ? null : ref)) };
  }

  // Every save shares the UPLOADS slots, and a slot passes to the next upload the moment one ends: a batch never waits
  // on its slowest upload while the link idles, and saves that overlap (runtime/characters saveAssets) never send more.
  private async uploadSlot(upload: () => Promise<void>) {
    if (this.uploading < UPLOADS) this.uploading++;
    else await new Promise<void>((resolve) => this.queued.push(resolve));
    try {
      await upload();
    } finally {
      const next = this.queued.shift();
      if (next) next();
      else this.uploading--;
    }
  }

  // The ids the server holds no readable file for (never stored, or blocked), the largest sealed body it takes and the
  // bytes left under the account's picture cap.
  async missing(ids: string[]): Promise<ApiResult<Missing>> {
    const missing = new Set<string>();
    let maxBytes = 0;
    let room: number | null = null;
    for (let start = 0; start < ids.length; start += MAX_FILE_IDS) {
      const asked = await this.store.reaching(() => this.request<{ missing: string[]; maxBytes: number; room: number | null }>('POST', 'files/missing', { ids: ids.slice(start, start + MAX_FILE_IDS) }));
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
        const page = await this.store.reaching(() => this.request<{ ids: string[]; more: boolean; timeline: string; rev: number }>('GET', after ? `files?after=${after}` : 'files'), signal);
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
        const body = { timeline: pin.timeline, rev, unused: released, named };
        const answer = await this.store.reaching(() => this.request<{ released: number; taken: number }>('POST', 'files/sweep', body), signal);
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
    const put = await this.store.reaching(() => this.request('PUT', `files/${id}`, body));
    return put.ok ? { ok: true, data: id } : put;
  }

  // A body that does not open answers 'unreadable', never empty bytes. The wait ends with signal (a backup's 중지), not
  // only with the store.
  async read(ref: FileRef, { signal }: { signal?: AbortSignal } = {}): Promise<ApiResult<Uint8Array<ArrayBuffer>>> {
    const result = await this.store.reaching(() => this.request<Uint8Array<ArrayBuffer>>('GET', `files/${ref.id}`), signal);
    if (!result.ok) return result;
    const bytes = await openFile(ref, result.data);
    return bytes ? { ok: true, data: bytes } : { ok: false, error: 'unreadable' };
  }
}
