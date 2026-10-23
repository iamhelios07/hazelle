import { expect, test } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enter, FAKE_MODEL, FAKE_PROVIDER, fakeProvider, settingsPage, setUp, startServer, stopServer } from './helpers';

// Someone's own installation, as docker-compose.yml and the start without Docker run it: a server of its own, since the
// suite's runs as hazelle.app. hazelle.app itself is answered here, so nothing leaves the machine.
const PORT = 4422;
let server: ChildProcess;

test.use({ baseURL: `http://localhost:${PORT}` });
test.beforeAll(async () => {
  server = await startServer(PORT, join(tmpdir(), 'hazelle-self-host-spec'), true, { HAZELLE_SELF_HOST: '1' });
});
test.afterAll(() => stopServer(server));

test("a self-host opens 게시판 and 헤이젤 나우 on hazelle.app and lists what leaves it in place of hazelle.app's terms", async ({ page, context }) => {
  await context.route('https://hazelle.app/**', (route) => route.fulfill({ contentType: 'text/html', body: 'hazelle.app' }));
  await page.goto('/');
  await setUp(page, 'self-host-password');
  await expect(page.getByRole('heading', { name: '비어 있어요', exact: true })).toBeVisible();

  const board = context.waitForEvent('page');
  await page.getByRole('button', { name: '게시판', exact: true }).click();
  expect((await board).url()).toBe('https://hazelle.app/board');

  await page.getByRole('button', { name: '설정', exact: true }).click();
  await settingsPage(page, '계정');
  await expect(page.getByRole('link', { name: '밖으로 나가는 정보' })).toBeVisible();
  await expect(page.getByRole('link', { name: '이용약관' })).toHaveCount(0);
  await expect(page.getByText('공유한 링크')).toHaveCount(0);

  await page.goto('/now');
  await expect(page).toHaveURL('https://hazelle.app/now');
});

test('a self-host offers the model servers of its machine that answer, and connects one in a tap', async ({ page }) => {
  await fakeProvider();
  await enter(page, 'self-host-password');
  await page.getByRole('button', { name: /^새 연결/ }).click();
  await page.getByRole('button', { name: new RegExp(`^${FAKE_PROVIDER.replaceAll('.', '\\.')}`) }).click();
  await expect(page.getByRole('button', { name: `${FAKE_MODEL} 추가`, exact: true })).toBeVisible();
});
