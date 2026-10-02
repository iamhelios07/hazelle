import { openFile, sealFile, type FileRef } from '../vault/files';
import type { ApiResult, api as realApi } from './api';

type Api = typeof realApi;

const UPLOADS = 4;
const REFUSED = new Set(['too-large', 'file-blocked', 'files-full']);

// The stored files (server/files). A file is sealed by its content, so one the server already holds, from this
// account or any other, is never sent again; an import cut short and tried again sends only what did not arrive.
export class Files {
  constructor(private readonly request: Api) {}

  // Each file's reference, in order; null for one the server refuses: too large, blocked (taken down by the operator),
  // or past the account's picture cap, which the caller leaves out and counts as it does a picture it cannot read.
  async save(files: Uint8Array<ArrayBuffer>[]): Promise<ApiResult<(FileRef | null)[]>> {
    const sealed = await Promise.all(files.map(sealFile));
    const asked = await this.request<{ missing: string[] }>('POST', 'files/missing', { ids: [...new Set(sealed.map(({ ref }) => ref.id))] });
    if (!asked.ok) return asked;
    const missing = [...new Set(asked.data.missing)];
    const refused = new Set<string>();
    for (let start = 0; start < missing.length; start += UPLOADS) {
      const puts = await Promise.all(
        missing.slice(start, start + UPLOADS).map(async (id) => {
          const put = await this.request('PUT', `files/${id}`, sealed.find(({ ref }) => ref.id === id)!.body);
          if (!put.ok && REFUSED.has(put.error)) refused.add(id);
          return put;
        }),
      );
      const failed = puts.find((put) => !put.ok && !REFUSED.has(put.error));
      if (failed && !failed.ok) return failed;
    }
    return { ok: true, data: sealed.map(({ ref }) => (refused.has(ref.id) ? null : ref)) };
  }

  // A body that does not open answers 'unreadable', never empty bytes.
  async read(ref: FileRef): Promise<ApiResult<Uint8Array<ArrayBuffer>>> {
    const result = await this.request<Uint8Array<ArrayBuffer>>('GET', `files/${ref.id}`);
    if (!result.ok) return result;
    const bytes = await openFile(ref, result.data);
    return bytes ? { ok: true, data: bytes } : { ok: false, error: 'unreadable' };
  }
}
