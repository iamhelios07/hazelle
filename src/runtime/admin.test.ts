import { expect, it, vi } from 'vitest';
import { loadSession, sendReport } from './account';
import { beginRestore, continueRestore, readAccounts, readLog, readReports, readRestores, readService, removeAccount, resolveReport, setService, setSuspended, type Restore } from './admin';
import { testServer } from './testing';

const server = testServer();

it('sets the service, suspends an account and resolves its report, each read back newest first in one short page', async () => {
  const { accountId } = await server.operator();
  expect(await setService({ signupCap: 5, accountBytesCap: 1_000_000, accountFileBytesCap: null })).toMatchObject({ ok: true });
  expect(await readService()).toMatchObject({ ok: true, data: { signupCap: 5, accountBytesCap: 1_000_000, accountFileBytesCap: null, accounts: 1, fileBytes: 0 } });

  expect(await setSuspended(accountId, true)).toMatchObject({ ok: true });
  expect(await readAccounts()).toMatchObject({ ok: true, data: { accounts: [{ accountId, suspended: true }] } });
  expect(await loadSession()).toMatchObject({ ok: true, data: { session: { admin: true, suspended: true } } });

  expect(await sendReport('그림이 이상해요')).toMatchObject({ ok: true });
  const reports = await readReports(null);
  expect(reports).toMatchObject({ ok: true, data: { rows: [{ accountId, text: '그림이 이상해요', resolvedAt: null }], more: false } });
  expect(await resolveReport(reports.ok ? reports.data.rows[0]!.id : 0)).toMatchObject({ ok: true });
  const log = await readLog(null);
  expect(log.ok && log.data.rows.map((row) => row.action)).toEqual(['resolve-report', 'suspend', 'set-service']);
  expect(log.ok && log.data.more).toBe(false);
});

// The server's answers in turn, and what each request sent.
function answering(...answers: Response[]) {
  const sent: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    sent.push({ url, method: init.method ?? 'GET', body: init.body === undefined ? undefined : JSON.parse(init.body as string) });
    return answers.shift()!;
  });
  return sent;
}

it('reads accounts whose usage is unknown or that are held, with totals dated and the unread counted', async () => {
  const unread = { accountId: 'b', username: 'bee', createdAt: 1, suspended: false, state: 'restoring', bytes: null, disk: null, fileBytes: 30, bytesCap: 'default', fileBytesCap: null };
  const totals = { bytes: 120, disk: 4096, unread: 1, readAt: 1_700_000_000_000 };
  answering(Response.json({ accounts: [unread], totals }));
  expect(await readAccounts()).toEqual({ ok: true, data: { accounts: [unread], totals } });
});

it('finishes a leaving account by removing it again', async () => {
  const sent = answering(new Response(null, { status: 204 }));
  expect(await removeAccount('a')).toEqual({ ok: true, data: undefined });
  expect(sent).toEqual([{ url: '/api/admin/accounts/a', method: 'DELETE', body: undefined }]);
});

it('asks a restore and an undo on a report, reads the restores with their actions, and continues one', async () => {
  const restore: Restore = {
    id: 7, reportId: 3, at: 1_700_000_000_000, undoes: null, phase: 'done', verified: true, error: null,
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
  expect(await continueRestore(8, 'resume')).toMatchObject({ ok: true, data: { phase: 'done', verified: false } });
  expect(await beginRestore('a', { report: 3, at: 1 })).toEqual({ ok: false, error: 'bad-time', retryAfter: undefined });
  expect(sent.map(({ url, method, body }) => [method, url, body])).toEqual([
    ['POST', '/api/admin/accounts/a/restores', { report: 3, at: restore.at }],
    ['GET', '/api/admin/accounts/a/restores', undefined],
    ['POST', '/api/admin/accounts/a/restores', { report: 4, undoes: 7 }],
    ['POST', '/api/admin/restores/8/resume', undefined],
    ['POST', '/api/admin/accounts/a/restores', { report: 3, at: 1 }],
  ]);
});
