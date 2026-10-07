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
