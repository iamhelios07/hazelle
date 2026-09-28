import type { ApiResult } from './api';

type Row = { id: string; kind: string; parent: string | null; rev: number; body: string | null };

// The server's object and blob routes in memory, for tests: the same version checks, without D1 or R2.
export function fakeServer() {
  const rows = new Map<string, Row>();
  const blobs = new Map<string, Uint8Array<ArrayBuffer>>();
  let rev = 0;
  async function request<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
    const ok = (data: unknown) => ({ ok: true, data }) as ApiResult<T>;
    const [route, id] = path.split('/') as [string, string];
    if (route === 'blobs') {
      if (method === 'PUT') blobs.set(id, body as Uint8Array<ArrayBuffer>);
      if (method === 'DELETE') blobs.delete(id);
      if (method !== 'GET') return ok(undefined);
      const bytes = blobs.get(id);
      return bytes ? ok(bytes) : { ok: false, error: 'not-found' };
    }
    if (method === 'GET') {
      const since = Number(path.split('since=')[1]);
      const changes = [...rows.values()].filter((row) => row.rev > since).sort((a, b) => a.rev - b.rev);
      return ok({ changes, cursor: changes.at(-1)?.rev ?? since, more: false });
    }
    const input = body as { kind: string; parent?: string | null; body?: string; baseRev: number | null };
    const row = rows.get(id);
    const matches = input.baseRev === null ? !row : row?.rev === input.baseRev && row.kind === input.kind && (method === 'PUT' || row.body !== null);
    if (!matches) return { ok: false, error: 'conflict' };
    rows.set(id, { id, kind: input.kind, parent: input.parent ?? null, rev: ++rev, body: method === 'PUT' ? input.body! : null });
    return ok({ rev });
  }
  return { request, rows, blobs };
}
