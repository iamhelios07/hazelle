import { api, type ApiResult } from './api';

export type Page<T> = { rows: T[]; more: boolean };

// The server's PAGE_ROWS (server/admin): a page shorter than it is the last.
const PAGE_ROWS = 100;

export async function page<K extends string, T extends { id: number }>(path: string, key: K, before: number | null): Promise<ApiResult<Page<T>>> {
  const answer = await api<Record<K, T[]>>('GET', `${path}${before === null ? '' : `?before=${before}`}`);
  if (!answer.ok) return answer;
  const rows = answer.data[key];
  return { ok: true, data: { rows, more: rows.length === PAGE_ROWS } };
}
