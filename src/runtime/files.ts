import { MAX_FILE_IDS } from '../contracts/files';
import { fileId, openFile, sealFile, type FileRef } from '../vault/files';
import type { ApiResult, api as realApi } from './api';
import type { ObjectStore } from './store';

type Api = typeof realApi;
type Missing = { missing: Set<string>; maxBytes: number };

// runtime/api's SLOWEST_UPLOAD assumes this many uploads sharing one uplink.
const UPLOADS = 12;
const REFUSED = new Set(['too-large', 'file-blocked', 'files-full']);

// A file is sealed by its content, so one the server already holds, from this account or any other, is never sent
// again; an import cut short and tried again sends only what did not arrive. Asking, uploading and reading wait out a
// dropped connection the way the store's calls do (store.reaching): a backup reads thousands of pictures in a row, and
// one dropped read must not end it.
export class Files {
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
    for (const id of asked.data.missing) {
      if (bodies.get(id)!.length > asked.data.maxBytes) refused.add(id);
      else missing.push(id);
    }
    for (let start = 0; start < missing.length; start += UPLOADS) {
      if (signal?.aborted) return { ok: false, error: 'stopped' };
      const puts = await Promise.all(
        missing.slice(start, start + UPLOADS).map(async (id) => {
          const put = await this.store.reaching(() => this.request('PUT', `files/${id}`, bodies.get(id)!), signal);
          if (!put.ok && REFUSED.has(put.error)) refused.add(id);
          return put;
        }),
      );
      const failed = puts.find((put) => !put.ok && !REFUSED.has(put.error));
      if (failed && !failed.ok) return failed;
    }
    return { ok: true, data: sealed.map(({ ref }) => (refused.has(ref.id) ? null : ref)) };
  }

  // The ids the server holds no readable file for (never stored, or blocked) and the largest sealed body it takes.
  async missing(ids: string[]): Promise<ApiResult<Missing>> {
    const missing = new Set<string>();
    let maxBytes = 0;
    for (let start = 0; start < ids.length; start += MAX_FILE_IDS) {
      const asked = await this.store.reaching(() => this.request<{ missing: string[]; maxBytes: number }>('POST', 'files/missing', { ids: ids.slice(start, start + MAX_FILE_IDS) }));
      if (!asked.ok) return asked;
      for (const id of asked.data.missing) missing.add(id);
      maxBytes = asked.data.maxBytes;
    }
    return { ok: true, data: { missing, maxBytes } };
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
