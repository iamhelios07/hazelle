import { defineConfig } from '@playwright/test';

const PORT = 4417;
// Signup closes after the first account, so every run starts from an empty local D1 and R2 of its own,
// apart from the one `npm run dev` uses.
const STATE = '.wrangler/e2e';
const WRANGLER = './node_modules/.bin/wrangler';

// Serves the build (npm run e2e builds first) through wrangler dev; T6 of the Docker port moves this to the Node server.
// wrangler dev takes no -c: it finds the built Worker and assets through the .wrangler/deploy/config.json
// that vite build writes, where wrangler.jsonc names no assets at all.
export default defineConfig({
  testDir: 'e2e',
  // The store spec runs on a wrapped Worker of its own (playwright.store.config.ts).
  testIgnore: 'store.spec.ts',
  workers: 1,
  reporter: 'list',
  timeout: 120_000,
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: [
      `node -e "require('node:fs').rmSync('${STATE}', { recursive: true, force: true })"`,
      `${WRANGLER} d1 migrations apply risu-alpha --local --persist-to ${STATE} -c wrangler.jsonc`,
      `${WRANGLER} dev --port ${PORT} --persist-to ${STATE}`,
    ].join(' && '),
    url: `http://localhost:${PORT}/api/session`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
