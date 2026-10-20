import { expect, type Page } from '@playwright/test';
import { CARD, pickBot, signInFromGuest, signUpAsGuest } from './helpers';

// The screenshot account on the local dev server (playwright.shots.config.ts), kept across runs so a screenshot
// script signs in instead of signing up. On a .data/ with no account the first run makes it, with the test card; as the
// first signup it is the installation's operator.
export const SHOTS = { username: 'shots', password: 'shots-password' };

// The layouts worth showing: a side panel sits beside the page from 1280px, covers it below, and the phone layout
// starts under 960px. Crossing 960px remounts the page (a new chat rolls its greeting again), so set the size before
// opening what is shown.
export const SIZES = { wide: { width: 1440, height: 900 }, medium: { width: 1100, height: 800 }, phone: { width: 390, height: 844 } };

// Saved as shots/out/<name>.png once menus and panels have faded in.
// Also a half-size copy in shots/out/look/, to read back: an image costs context by its pixels. It is the screenshot
// drawn again in a page of half the size, so the page shot is left as it was.
export async function snap(page: Page, name: string) {
  await page.waitForTimeout(400);
  const full = await page.screenshot({ path: `shots/out/${name}.png` });
  const { width, height } = page.viewportSize()!;
  const look = await page.context().newPage();
  await look.setViewportSize({ width: Math.round(width / 2), height: Math.round(height / 2) });
  await look.setContent(`<body style="margin:0"><img style="display:block;width:100%" src="data:image/png;base64,${full.toString('base64')}">`);
  await look.screenshot({ path: `shots/out/look/${name}.png` });
  await look.close();
}

export async function enterShots(page: Page) {
  await page.goto('/');
  const signup = page.getByRole('button', { name: '계정 만들기', exact: true });
  const full = page.getByText('지금은 정원이 차서 계정을 만들 수 없어요', { exact: true });
  await expect(signup.or(full)).toBeVisible();
  // 계정 만들기 is open only while signup is, which with the default cap of one is until the first account exists.
  if (await full.isVisible()) return signInFromGuest(page, SHOTS.username, SHOTS.password);
  await signUpAsGuest(page, SHOTS.username, SHOTS.password);
  const chooser = page.waitForEvent('filechooser');
  await pickBot(page);
  await page.getByRole('button', { name: '확인했어요', exact: true }).click();
  await (await chooser).setFiles(CARD);
  await page.getByRole('dialog', { name: '가져왔어요', exact: true }).getByRole('button', { name: '채팅 시작', exact: true }).click();
}
