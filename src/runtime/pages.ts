import { api, type ApiResult } from './api';

// next: what the following page is asked after, null on the last (server/admin page).
export type Page<T> = { rows: T[]; next: string | null };
// limit: the rows asked, the server's page when absent. A true flag narrows the list; a false one is left out.
export type Ask = Record<string, string | number | boolean | undefined>;

export async function page<K extends string, T>(path: string, key: K, after: string | null, ask: Ask = {}, headers: Record<string, string> = {}): Promise<ApiResult<Page<T>>> {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(ask)) if (value !== undefined && value !== false) query.set(name, value === true ? '1' : String(value));
  if (after !== null) query.set('after', after);
  const answer = await api<Record<K, T[]> & { next: string | null }>('GET', query.size ? `${path}?${query}` : path, undefined, undefined, undefined, headers);
  if (!answer.ok) return answer;
  return { ok: true, data: { rows: answer.data[key], next: answer.data.next } };
}
