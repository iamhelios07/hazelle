import { expect, it, vi } from 'vitest';
import type { Connection } from '../connectors/types';
import { loadSession, markNoticesSeen, readNotices, sendReport } from './account';
import { readAccounts, readAdminAccount, readServiceUsage, readLog, readReports, readService, removeAccount, resolveReport, sendNotice, setService, suspend } from './admin';
import { beginRestore, continueRestore, readPoints, readRestores, type Restore } from './restores';
import { testServer } from './testing';

const server = testServer();

it('sets the service, suspends an account and resolves its report, each read back newest first in one short page', async () => {
  const { accountId } = await server.operator();
  expect(await setService({ signupCap: 5, accountBytesCap: 1_000_000, accountFileBytesCap: null })).toMatchObject({ ok: true });
  expect(await readService()).toEqual({
    ok: true,
    data: { signupCap: 5, accountBytesCap: 1_000_000, accountFileBytesCap: null, accounts: 1, people: 1, pending: 0, fileBytes: 0, links: 0, databaseBytes: expect.any(Number), backupAgeHours: null, diskFreePercent: expect.any(Number), warnings: expect.any(Array) },
  });

  expect(await suspend(accountId, '도배')).toMatchObject({ ok: true });
  expect(await readAccounts(null)).toMatchObject({ ok: true, data: { rows: [{ accountId, suspended: true }] } });
  expect(await loadSession()).toMatchObject({ ok: true, data: { session: { admin: true, suspended: true } } });

  expect(await sendReport('그림이 이상해요', null)).toMatchObject({ ok: true });
  const reports = await readReports(null);
  expect(reports).toMatchObject({ ok: true, data: { rows: [{ accountId, text: '그림이 이상해요', resolvedAt: null }], next: null } });
  expect(await resolveReport(reports.ok ? reports.data.rows[0]!.id : 0)).toMatchObject({ ok: true });
  const log = await readLog(null);
  expect(log.ok && log.data.rows.map((row) => row.action)).toEqual(['resolve-report', 'send-notice', 'suspend', 'set-service']);
  expect(log.ok && log.data.next).toBeNull();
});

it('sends notices with a reply, a reason and to everyone, which the account reads newest first, counted unread until seen', async () => {
  const { accountId } = await server.operator();
  await sendReport('도와주세요', null);
  const reports = await readReports(null);
  const report = reports.ok ? reports.data.rows[0]!.id : 0;
  expect(await resolveReport(report, '고쳤어요')).toMatchObject({ ok: true });
  expect(await suspend(accountId, '잠시 멈춰요')).toMatchObject({ ok: true });
  expect(await sendNotice(null, '점검해요')).toMatchObject({ ok: true });

  expect(await loadSession()).toMatchObject({ ok: true, data: { session: { unreadNotices: 3 } } });
  const notices = await readNotices(null);
  expect(notices).toMatchObject({ ok: true, data: { rows: [{ text: '점검해요' }, { text: '잠시 멈춰요', reportId: null }, { text: '고쳤어요', reportId: report }], next: null } });
  expect(await markNoticesSeen(notices.ok ? notices.data.rows[0]!.id : 0)).toMatchObject({ ok: true });
  expect(await loadSession()).toMatchObject({ ok: true, data: { session: { unreadNotices: 0 } } });
});

it('restores an account to a time on its report: its open device drops to the objects of that time, and the restore reads back with its undo', async () => {
  const { accountId, store, open } = await server.operator();
  const connection = (label: string): Connection => ({ type: 'openrouter', label, baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'sk-or-x' }], turns: null, starred: [] });
  const now = Date.now();
  server.at(() => now - 3_600_000);
  const kept = await store.create('connection', connection('kept'));
  await server.baseline(accountId);
  server.at(() => now - 1_800_000);
  await store.create('connection', connection('later'));
  server.at(() => Date.now());
  await sendReport('되돌려 주세요', null);
  const reports = await readReports(null);
  const report = reports.ok ? reports.data.rows[0]!.id : 0;
  const at = now - 2_700_000;

  expect(await readPoints(accountId)).toEqual({ ok: true, data: [{ at: now - 3_600_000, takenAt: now - 3_600_000, kind: 'baseline' }] });
  const rewound = vi.fn();
  store.subscribeRewound(rewound);
  const run = await beginRestore(accountId, { report, at });
  expect(run).toEqual({ ok: true, data: { id: expect.any(Number), phase: 'done', verified: true, error: null } });
  expect(await store.pull()).toEqual({ ok: false, error: 'timeline-changed' });
  await vi.waitFor(() => expect(rewound).toHaveBeenCalledWith(0));
  const reopened = await open();
  expect(await reopened.pull()).toBeNull();
  expect(reopened.list('connection')).toEqual([kept.ok && kept.data]);

  expect(await readRestores(accountId)).toEqual({ ok: true, data: [{
    id: run.ok && run.data.id, reportId: report, at, undoes: null, targetAt: now - 3_600_000, phase: 'done', verified: true, error: null,
    createdAt: expect.any(Number), updatedAt: expect.any(Number), canUndo: true, undoExpiresAt: expect.any(Number), actions: [],
  }] });
  expect(await readAccounts(null)).toMatchObject({ ok: true, data: { rows: [{ accountId, state: 'active', bytes: expect.any(Number) }], next: null } });
  const log = await readLog(null);
  expect(log.ok && log.data.rows.map((row) => row.action)).toEqual(['restore-done', 'restore-begun']);
});

function answering(...answers: Response[]) {
  const sent: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    sent.push({ url, method: init.method ?? 'GET', body: init.body === undefined ? undefined : JSON.parse(init.body as string) });
    return answers.shift()!;
  });
  return sent;
}

it('reads a bounded account page whose usage can be unknown or held', async () => {
  const unread = { accountId: 'b', username: 'bee', createdAt: 1, suspended: false, state: 'restoring', bytes: null, disk: null, fileBytes: 30, bytesCap: 'default', fileBytesCap: null };
  answering(Response.json({ accounts: [unread], next: null }));
  expect(await readAccounts(null)).toEqual({ ok: true, data: { rows: [unread], next: null } });
});

it('refreshes a single account and explicitly sums usage pages without retaining account rows', async () => {
  const totals = { bytes: 2, disk: 4, unread: 0, readAt: 10 };
  const sent = answering(
    Response.json({ account: null }),
    Response.json({ accounts: 100, totals, next: '10:account' }),
    Response.json({ accounts: 1, totals: { bytes: 0, disk: 0, unread: 1, readAt: 11 }, next: null }),
  );
  expect(await readAdminAccount('gone')).toEqual({ ok: true, data: { account: null } });
  const progress = vi.fn();
  expect(await readServiceUsage(progress, new AbortController().signal)).toEqual({ ok: true, data: { accounts: 101, bytes: 2, disk: 4, unread: 1, readAt: 10 } });
  expect(progress).toHaveBeenCalledTimes(2);
  expect(sent.map(({ url }) => url)).toEqual(['/api/admin/accounts/gone', '/api/admin/usage', '/api/admin/usage?after=10%3Aaccount']);
});

it('stops an explicit usage traversal before requesting its next page', async () => {
  const stop = new AbortController();
  const sent = answering(Response.json({ accounts: 100, totals: { bytes: 1, disk: 2, unread: 0, readAt: 3 }, next: '3:account' }));
  expect(await readServiceUsage(() => stop.abort(), stop.signal)).toEqual({ ok: false, error: 'stopped' });
  expect(sent).toHaveLength(1);
});

it('finishes a leaving account by removing it again', async () => {
  const sent = answering(new Response(null, { status: 204 }));
  expect(await removeAccount('a')).toEqual({ ok: true, data: undefined });
  expect(sent).toEqual([{ url: '/api/admin/accounts/a', method: 'DELETE', body: undefined }]);
});

it('asks a restore and an undo on a report, reads the restores with their actions, and continues one', async () => {
  const restore: Restore = {
    id: 7, reportId: 3, at: 1_700_000_000_000, undoes: null, targetAt: 1_699_999_000_000, phase: 'done', verified: true, error: null,
    createdAt: 1_700_000_100_000, updatedAt: 1_700_000_200_000, canUndo: true, undoExpiresAt: 1_702_000_000_000, actions: [],
  };
  const stuck: Restore = { ...restore, id: 8, at: null, undoes: 7, phase: 'armed', error: 'rewind-pending', canUndo: false, undoExpiresAt: null, actions: ['resume'] };
  const sent = answering(
    Response.json({ id: 7, phase: 'done', verified: true, error: null }),
    Response.json({ restores: [stuck, restore] }),
    Response.json({ id: 8, phase: 'armed', verified: false, error: 'rewind-pending' }),
    Response.json({ id: 8, phase: 'done', verified: false, error: null }),
    Response.json({ error: 'bad-time' }, { status: 400 }),
  );
  expect(await beginRestore('a', { report: 3, at: restore.at! })).toEqual({ ok: true, data: { id: 7, phase: 'done', verified: true, error: null } });
  expect(await readRestores('a')).toEqual({ ok: true, data: [stuck, restore] });
  expect(await beginRestore('a', { report: 4, undoes: 7 })).toMatchObject({ ok: true, data: { phase: 'armed', error: 'rewind-pending' } });
  expect(await continueRestore('a', 8, 'resume')).toMatchObject({ ok: true, data: { phase: 'done', verified: false } });
  expect(await beginRestore('a', { report: 3, at: 1 })).toEqual({ ok: false, error: 'bad-time', retryAfter: undefined });
  expect(sent.map(({ url, method, body }) => [method, url, body])).toEqual([
    ['POST', '/api/admin/accounts/a/restores', { report: 3, at: restore.at }],
    ['GET', '/api/admin/accounts/a/restores', undefined],
    ['POST', '/api/admin/accounts/a/restores', { report: 4, undoes: 7 }],
    ['POST', '/api/admin/restores/8/resume', undefined],
    ['POST', '/api/admin/accounts/a/restores', { report: 3, at: 1 }],
  ]);
});
