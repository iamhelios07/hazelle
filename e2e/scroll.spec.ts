import { expect, test } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

let server: ViteDevServer;
let url: string;

test.beforeAll(async () => {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 }, clearScreen: false });
  await server.listen();
  url = server.resolvedUrls!.local[0]!;
});

test.afterAll(async () => { await server?.close(); });

for (const reply of ['stay', 'follow']) {
  test(`a growing reply respects ${reply}, and explicit follow resumes tracking`, async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${url}e2e/fixtures/scroll.html?reply=${reply}`);
    const frame = page.locator('main > div').filter({ has: page.locator('[data-key]') });
    const position = () => frame.evaluate((element) => ({ top: element.scrollTop, end: element.scrollHeight - element.clientHeight }));
    const atBottom = async () => expect.poll(async () => {
      const { top, end } = await position();
      return Math.abs(end - top);
    }).toBeLessThanOrEqual(1);
    await atBottom();
    await page.getByRole('button', { name: 'Reply', exact: true }).click();
    await expect(page.locator('[data-key="reply"]')).toBeAttached();
    await atBottom();
    const start = await position();
    const grow = async () => {
      await page.getByRole('button', { name: 'Grow', exact: true }).click();
      // ResizeObserver measurements and the browser's anchoring run after the DOM update.
      await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    };
    for (let i = 0; i < 10; i++) {
      await grow();
      if (reply === 'stay') expect(Math.abs((await position()).top - start.top)).toBeLessThanOrEqual(1);
      else await atBottom();
    }
    expect((await position()).end).toBeGreaterThan(start.end + 400);
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    if (reply === 'stay') expect(Math.abs((await position()).top - start.top)).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Follow', exact: true }).click();
    await atBottom();
    await grow();
    await atBottom();
    expect(errors).toEqual([]);
  });
}

test('a staying reply raises the pill under a reader at the end only once a view is unread below, and the composer growing keeps that end in view', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(`${url}e2e/fixtures/scroll.html?reply=stay`);
  const frame = page.locator('main > div').filter({ has: page.locator('[data-key]') });
  const distance = () => frame.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop);
  const frames = () => page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const pill = page.locator('output');
  const press = async (name: string) => {
    await page.getByRole('button', { name, exact: true }).click();
    await frames();
  };
  await press('Reply');
  for (let i = 0; i < 10; i++) await press('Grow');
  // Instant, as a smooth wheel would still be moving once the story grows and carry the view down on its own.
  await frame.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(pill).toHaveCount(0);
  const top = await frame.evaluate((element) => element.scrollTop);
  await press('Grow');
  await press('Finish');
  await press('Grow');
  expect(await frame.evaluate((element) => element.scrollTop)).toBe(top);
  await expect(pill).toHaveCount(0);
  await frame.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await press('Type');
  expect(await distance()).toBeLessThanOrEqual(1);
  await expect(pill).toHaveCount(0);
  const height = await frame.evaluate((element) => element.clientHeight);
  for (let grown = 0; grown <= height; grown += 100) await press('Grow');
  await expect(pill).toHaveText('맨 아래로');
  await frame.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(pill).toHaveCount(0);
  await frame.evaluate((element) => { element.scrollTop -= 300; });
  await expect(pill).toHaveText('맨 아래로');
});

test('a story drawn again, as a message flipped to its original, keeps the paragraph at the top of the view in place', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(`${url}e2e/fixtures/redraw.html`);
  const frame = page.locator('main > div').filter({ has: page.locator('[data-key]') });
  await page.locator('[data-key="long"]').waitFor();
  const place = () => frame.evaluate((element) => {
    const paragraph = element.querySelector('[data-key="long"] div[data-buttons]')!.shadowRoot!.querySelector('[data-i="20"]')!;
    return paragraph.getBoundingClientRect().top - element.getBoundingClientRect().top;
  });
  const frames = () => page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await frame.evaluate((element) => {
    const paragraph = element.querySelector('[data-key="long"] div[data-buttons]')!.shadowRoot!.querySelector('[data-i="20"]')!;
    element.scrollTop += paragraph.getBoundingClientRect().top - element.getBoundingClientRect().top - 10;
    element.dispatchEvent(new Event('scroll'));
  });
  await frames();
  const before = await place();
  for (let round = 0; round < 2; round++) {
    await page.getByRole('button', { name: 'Flip', exact: true }).click();
    await frames();
    expect(Math.abs((await place()) - before)).toBeLessThanOrEqual(1);
  }
});
