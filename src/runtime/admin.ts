import { api, type ApiResult } from './api';

// The operator's calls (server/admin). Only the account the Worker names passes; any other is answered not-admin.

// The caps every account has unless given its own; null is no cap. fileBytes: every account's pictures together.
export type Service = { signupCap: number; accountBytesCap: number | null; accountFileBytesCap: number | null; accounts: number; fileBytes: number };
// An account's own cap: bytes, null for none, or 'default' for the service's.
export type OwnCap = number | null | 'default';
// restoring: held by a restore until it ends. leaving: its deletion stopped before the end; removing it again finishes it.
export type AccountState = 'active' | 'restoring' | 'leaving';
// bytes and disk (what the account's store takes on the server) are null when its store was not read: it did not answer in
// time, or the account is not active. fileBytes: its pictures.
export type AdminAccount = {
  accountId: string;
  username: string;
  createdAt: number;
  suspended: boolean;
  state: AccountState;
  bytes: number | null;
  disk: number | null;
  fileBytes: number;
  bytesCap: OwnCap;
  fileBytesCap: OwnCap;
};
// The accounts read at readAt; the sums leave out the unread ones.
export type Totals = { bytes: number; disk: number; unread: number; readAt: number };
export type Report = { id: number; accountId: string; username: string; text: string; createdAt: number; resolvedAt: number | null };
// detail: what the server logged with it, such as the account's username or the service values set.
export type LogRow = { id: number; at: number; action: string; target: string; detail: unknown };
// more: a full page came, so an older one may follow.
export type Page<T> = { rows: T[]; more: boolean };

// The server's PAGE_ROWS (server/admin): a page shorter than it is the last.
const PAGE_ROWS = 100;

export const readService = () => api<Service>('GET', 'admin/service');
export const setService = (values: Pick<Service, 'signupCap' | 'accountBytesCap' | 'accountFileBytesCap'>) => api<undefined>('PUT', 'admin/service', values);

export const readAccounts = () => api<{ accounts: AdminAccount[]; totals: Totals }>('GET', 'admin/accounts');

export const setSuspended = (account: string, suspended: boolean) => api<undefined>('PUT', `admin/accounts/${account}/suspended`, { suspended });
export const setCaps = (account: string, caps: Pick<AdminAccount, 'bytesCap' | 'fileBytesCap'>) => api<undefined>('PUT', `admin/accounts/${account}/caps`, caps);
// Also finishes the deletion of a leaving account.
export const removeAccount = (account: string) => api<undefined>('DELETE', `admin/accounts/${account}`);

// A restore rewinds an account's stored objects to a time; an undo rewinds them to just before a restore. Each runs only
// on a report that account sent. The phases run in order; from armed on, a restore can only go forward.
export type RestorePhase = 'begun' | 'fenced' | 'checkpointed' | 'targeted' | 'armed' | 'rewound' | 'done' | 'failed' | 'cancelled';
export type RestoreAction = 'resume' | 'cancel' | 'finalize';
// at: the time asked for, null for an undo. undoes: the restore an undo rewinds. verified: the account was seen open again
// after done. actions: what the server allows in this phase.
export type Restore = {
  id: number;
  reportId: number;
  at: number | null;
  undoes: number | null;
  phase: RestorePhase;
  verified: boolean;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  canUndo: boolean;
  undoExpiresAt: number | null;
  actions: RestoreAction[];
};
// Where a run stopped: done, or a phase that waits for the operator.
export type RestoreRun = Pick<Restore, 'id' | 'phase' | 'verified' | 'error'>;
export type RestoreAsk = { report: number; at: number } | { report: number; undoes: number };

export async function readRestores(account: string): Promise<ApiResult<Restore[]>> {
  const answer = await api<{ restores: Restore[] }>('GET', `admin/accounts/${account}/restores`);
  return answer.ok ? { ok: true, data: answer.data.restores } : answer;
}

// The server runs the restore in this request, so the answer comes when it is done or stopped.
export const beginRestore = (account: string, ask: RestoreAsk) => api<RestoreRun>('POST', `admin/accounts/${account}/restores`, ask);
export const continueRestore = (restore: number, action: RestoreAction) => api<RestoreRun>('POST', `admin/restores/${restore}/${action}`);

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
