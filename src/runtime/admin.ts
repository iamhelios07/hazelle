import { api, type ApiResult } from './api';

// The operator's calls (server/admin). Only the account the Worker names passes; any other is answered not-admin.

// The caps every account has unless given its own; null is no cap. bytes: every account's object bodies together.
// fileBytes: every stored file.
export type Service = { signupCap: number; accountBytesCap: number | null; accountFileBytesCap: number | null; accounts: number; bytes: number; fileBytes: number };
// An account's own cap: bytes, null for none, or 'default' for the service's.
export type OwnCap = number | null | 'default';
// fileBytes: the files it was first to store.
export type AdminAccount = { accountId: string; username: string; createdAt: number; suspended: boolean; bytes: number; fileBytes: number; bytesCap: OwnCap; fileBytesCap: OwnCap };
export type Report = { id: number; accountId: string; username: string; text: string; createdAt: number; resolvedAt: number | null };
// detail: what the server logged with it, such as the account's username or the service values set.
export type LogRow = { id: number; at: number; action: string; target: string; detail: unknown };
// more: a full page came, so an older one may follow.
export type Page<T> = { rows: T[]; more: boolean };

// The server's PAGE_ROWS (server/admin): a page shorter than it is the last.
const PAGE_ROWS = 100;

export const readService = () => api<Service>('GET', 'admin/service');
export const setService = (values: Pick<Service, 'signupCap' | 'accountBytesCap' | 'accountFileBytesCap'>) => api<undefined>('PUT', 'admin/service', values);

export async function readAccounts(): Promise<ApiResult<AdminAccount[]>> {
  const answer = await api<{ accounts: AdminAccount[] }>('GET', 'admin/accounts');
  return answer.ok ? { ok: true, data: answer.data.accounts } : answer;
}

export const setSuspended = (account: string, suspended: boolean) => api<undefined>('PUT', `admin/accounts/${account}/suspended`, { suspended });
export const setCaps = (account: string, caps: Pick<AdminAccount, 'bytesCap' | 'fileBytesCap'>) => api<undefined>('PUT', `admin/accounts/${account}/caps`, caps);
export const removeAccount = (account: string) => api<undefined>('DELETE', `admin/accounts/${account}`);

// Newest first; before is the id of the last row already shown.
async function page<K extends string, T extends { id: number }>(path: string, key: K, before: number | null): Promise<ApiResult<Page<T>>> {
  const answer = await api<Record<K, T[]>>('GET', `admin/${path}${before === null ? '' : `?before=${before}`}`);
  if (!answer.ok) return answer;
  const rows = answer.data[key];
  return { ok: true, data: { rows, more: rows.length === PAGE_ROWS } };
}

export const readReports = (before: number | null) => page<'reports', Report>('reports', 'reports', before);
export const resolveReport = (id: number) => api<undefined>('POST', `admin/reports/${id}/resolve`);
export const readLog = (before: number | null) => page<'log', LogRow>('log', 'log', before);

// A stored file's id: the hex SHA-256 its sealed body hashes to (server/files FILE_ID).
export const FILE_ID = /^[0-9a-f]{64}$/;
export const setFileBlocked = (file: string, blocked: boolean) => api<undefined>('PUT', `admin/files/${file}/blocked`, { blocked });
