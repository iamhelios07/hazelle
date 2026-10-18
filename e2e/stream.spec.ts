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

test('a growing reply keeps the picture and the animation drawn before each chunk, and moves the cursor to its end', async ({ page }) => {
  await page.goto(`${url}e2e/fixtures/stream.html`);
  const story = page.locator('div[data-buttons]');
  await expect(story.locator('p.pulse')).toBeAttached();
  type Drawn = { picture: unknown; animation: unknown };
  await story.evaluate((host) => {
    const root = host.shadowRoot!;
    (host as unknown as { drawn: Drawn }).drawn = { picture: root.querySelector('img')!, animation: root.querySelector('.pulse')!.getAnimations()[0]! };
  });
  for (const button of ['Word', 'Paragraph', 'Word']) await page.getByRole('button', { name: button, exact: true }).click();
  await expect(story.locator('p').last()).toHaveText('Rain and waits');
  const kept = await story.evaluate((host) => {
    const root = host.shadowRoot!;
    const { picture, animation } = (host as unknown as { drawn: Drawn }).drawn;
    return {
      picture: root.querySelector('img') === picture,
      animation: root.querySelector('.pulse')!.getAnimations()[0] === animation,
      cursor: root.querySelector('slot[name="cursor"]')!.parentElement === root.lastElementChild,
    };
  });
  expect(kept).toEqual({ picture: true, animation: true, cursor: true });
});
