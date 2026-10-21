import { expect, test } from '@playwright/test';
import { enter } from './helpers';

// The 게시판 (design §6.13). The e2e account is the installation's first, the operator, who writes as 운영자 and is asked
// for no nickname; the nickname gate is the server's rule for every other account (server/board.test).
test('the operator posts, comments, votes, and finds it all after a reload', async ({ page }) => {
  await enter(page);
  await page.getByRole('button', { name: '게시판', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '게시판', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '글쓰기', exact: true }).click();

  await test.step('write a public post', async () => {
    await page.getByLabel('제목', { exact: true }).fill('첫 글');
    await page.getByRole('group', { name: '분류', exact: true }).getByRole('button', { name: '제안', exact: true }).click();
    await page.getByLabel('내용', { exact: true }).fill('게시판이 열렸어요. https://hazelle.app');
    await page.getByRole('button', { name: '올리기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '첫 글', exact: true })).toBeVisible();
    await expect(page.getByText(/^운영자/).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'https://hazelle.app', exact: true })).toBeVisible();
  });

  await test.step('comment and vote', async () => {
    await page.getByLabel('댓글', { exact: true }).fill('첫 댓글');
    await page.getByRole('button', { name: '등록', exact: true }).click();
    await expect(page.getByText('첫 댓글', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '추천 0', exact: true }).click();
    await expect(page.getByRole('button', { name: /^추천 1/ })).toBeVisible();
  });

  await test.step('the list and the post read back after a reload', async () => {
    await page.reload();
    await expect(page.getByRole('heading', { name: '첫 글', exact: true })).toBeVisible();
    await expect(page.getByText('첫 댓글', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^추천 1/ })).toBeVisible();
    await page.getByRole('button', { name: '게시판', exact: true }).first().click();
    await expect(page.getByRole('button', { name: /첫 글/ })).toBeVisible();
  });
});
