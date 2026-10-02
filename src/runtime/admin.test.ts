import { expect, it } from 'vitest';
import { loadSession, sendReport } from './account';
import { readAccounts, readLog, readReports, readService, resolveReport, setService, setSuspended } from './admin';
import { testServer } from './testing';

const server = testServer();

it('sets the service, suspends an account and resolves its report, each read back newest first in one short page', async () => {
  const { accountId } = await server.operator();
  expect(await setService({ signupCap: 5, accountBytesCap: 1_000_000, accountFileBytesCap: null })).toMatchObject({ ok: true });
  expect(await readService()).toEqual({ ok: true, data: { signupCap: 5, accountBytesCap: 1_000_000, accountFileBytesCap: null, accounts: 1, bytes: 0, fileBytes: 0 } });

  expect(await setSuspended(accountId, true)).toMatchObject({ ok: true });
  expect(await readAccounts()).toMatchObject({ ok: true, data: [{ accountId, suspended: true }] });
  expect(await loadSession()).toMatchObject({ ok: true, data: { session: { admin: true, suspended: true } } });

  expect(await sendReport('그림이 이상해요')).toMatchObject({ ok: true });
  const reports = await readReports(null);
  expect(reports).toMatchObject({ ok: true, data: { rows: [{ accountId, text: '그림이 이상해요', resolvedAt: null }], more: false } });
  expect(await resolveReport(reports.ok ? reports.data.rows[0]!.id : 0)).toMatchObject({ ok: true });
  const log = await readLog(null);
  expect(log.ok && log.data.rows.map((row) => row.action)).toEqual(['resolve-report', 'suspend', 'set-service']);
  expect(log.ok && log.data.more).toBe(false);
});
