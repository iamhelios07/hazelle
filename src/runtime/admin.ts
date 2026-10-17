import type { BackupWarning, AccountState } from '../contracts/admin';
import { api, SLOW_ROUTE_WAIT, type ApiResult } from './api';
import { page } from './pages';

// Only the operator's account (the installation's first signup, server/accounts) passes; any other is answered
// not-admin.

// The caps every account has unless given its own; null is no cap. accounts: the rows the signup cap counts, a leaving one
// too, since it holds its seat until removed. people: the accounts not leaving. pending: open reports plus held shares,
// a held share counted again with its report, so it is only ever zero or not. fileBytes: every account's pictures
// together. links: the links not cut. databaseBytes: the service database, which every backup copies whole.
// backupAgeHours: since the newest backup copied off-site, null for none yet. warnings: what the server says
// needs the operator (server/backup/freshness).
export type Service = {
  signupCap: number;
  accountBytesCap: number | null;
  accountFileBytesCap: number | null;
  accounts: number;
  people: number;
  pending: number;
  fileBytes: number;
  links: number;
  databaseBytes: number;
  backupAgeHours: number | null;
  diskFreePercent: number;
  warnings: BackupWarning[];
};
// An account's own cap: bytes, null for none, or 'default' for the service's.
export type OwnCap = number | null | 'default';
// bytes and disk (what the account's store takes on the server) are null when its store was not read: it did not answer in
// time, or the account is not active.
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
type Totals = { bytes: number; disk: number; unread: number; readAt: number };
// A report is an account's message, or a report on a share (share set) sent by anyone holding its link: accountId and
// username then name a signed-in reporter, else null. shared: the share's state now, null once it went with its sharer.
export type SharedState = { held: boolean; reviewed: boolean; cut: boolean; removed: boolean; ownerId: string | null; ownerName: string | null };
export type Report = {
  id: number;
  accountId: string | null;
  username: string | null;
  text: string;
  createdAt: number;
  resolvedAt: number | null;
  share: string | null;
  shareVersion: number | null;
  link: string | null;
  diagnostics: string | null;
  shared: SharedState | null;
};
export type LogRow = { id: number; at: number; action: string; target: string; detail: unknown };
export const readService = () => api<Service>('GET', 'admin/service');
export const setService = (values: Pick<Service, 'signupCap' | 'accountBytesCap' | 'accountFileBytesCap'>) => api<undefined>('PUT', 'admin/service', values);

export type AccountsPage = { accounts: AdminAccount[]; next: string | null };
const afterQuery = (after: string | null) => after === null ? '' : `?after=${encodeURIComponent(after)}`;
export const readAccounts = (after: string | null = null, signal?: AbortSignal) => api<AccountsPage>('GET', `admin/accounts${afterQuery(after)}`, undefined, signal);
export const readAdminAccount = (account: string) => api<{ account: AdminAccount | null }>('GET', `admin/accounts/${account}`);
// readAt: when the first page was read; later pages were read after it.
export type ServiceUsage = Totals & { accounts: number };
type UsagePage = { totals: Totals; accounts: number; next: string | null };

// Explicit operator refresh only: bounded pages return totals, never the complete account list.
export async function readServiceUsage(progress: (totals: ServiceUsage) => void, signal: AbortSignal): Promise<ApiResult<ServiceUsage>> {
  let next: string | null = null;
  let total: ServiceUsage | null = null;
  do {
    if (signal.aborted) return { ok: false, error: 'stopped' };
    const page: ApiResult<UsagePage> = await api<UsagePage>('GET', `admin/usage${afterQuery(next)}`, undefined, signal);
    if (!page.ok) return page;
    const read: ServiceUsage = { ...page.data.totals, accounts: page.data.accounts };
    total = total === null ? read : {
      bytes: total.bytes + read.bytes,
      disk: total.disk + read.disk,
      unread: total.unread + read.unread,
      accounts: total.accounts + read.accounts,
      readAt: total.readAt,
    };
    progress(total);
    next = page.data.next;
  } while (next !== null);
  return { ok: true, data: total };
}

// reason: a notice to the account, sent with the suspension.
export const suspend = (account: string, reason: string) => api<undefined>('PUT', `admin/accounts/${account}/suspended`, { suspended: true, reason });
export const liftSuspension = (account: string) => api<undefined>('PUT', `admin/accounts/${account}/suspended`, { suspended: false });
// Plaintext, to one account or, with null, to every account there now.
export const sendNotice = (to: string | null, text: string) => api<undefined>('POST', 'admin/notices', { to, text });
export const setCaps = (account: string, caps: Pick<AdminAccount, 'bytesCap' | 'fileBytesCap'>) => api<undefined>('PUT', `admin/accounts/${account}/caps`, caps);
// Also finishes the deletion of a leaving account.
export const removeAccount = (account: string) => api<undefined>('DELETE', `admin/accounts/${account}`, undefined, undefined, SLOW_ROUTE_WAIT);

export const readReports = (before: number | null) => page<'reports', Report>('admin/reports', 'reports', before);
// reply: a notice to the report's sender, sent with resolving it; blank sends none.
export const resolveReport = (id: number, reply = '') => api<undefined>('POST', `admin/reports/${id}/resolve`, { reply });
export const readLog = (before: number | null) => page<'log', LogRow>('admin/log', 'log', before);

export const setFileBlocked = (file: string, blocked: boolean) => api<undefined>('PUT', `admin/files/${file}/blocked`, { blocked });

// A share in any state: its versions, the manifest's file id of each. A report's link holds the key (runtime/share).
export const readShareVersions = (share: string) => api<{ versions: { version: number; manifest: string; createdAt: number }[] }>('GET', `admin/shares/${share}`);
// 보류, by a report or directly; 보류 풀기, which marks the share reviewed; 차단, of the version reviewed.
export const holdShare = (share: string) => api<undefined>('POST', `admin/shares/${share}/hold`);
export const releaseShare = (share: string) => api<undefined>('POST', `admin/shares/${share}/release`);
export const blockShare = (share: string, version: number, notice: string, suspend: boolean) => api<undefined>('POST', `admin/shares/${share}/block`, { version, notice, suspend });
