import { defineConfig } from '@playwright/test';
import { FAKE_PROVIDER } from './e2e/helpers';

const PORT = 5180;

// Screenshot scripts in shots/ (not tracked), against the dev server and its lasting data in .data/, where the account
// of e2e/shots.ts stays signed up. Unlike playwright.config.ts nothing is wiped between runs. A server already running
// on .data/ (npm run dev) is reused, since a second one would be refused the directory; it reaches fakeProvider only if
// it was started with the same HAZELLE_LOCAL_PROVIDERS.
export default defineConfig({
  testDir: 'shots',
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  // A wrong locator fails in 5 s instead of running out the test's 60 s; a longer wait carries its own timeout.
  use: { baseURL: `http://localhost:${PORT}`, actionTimeout: 5_000, navigationTimeout: 15_000 },
  webServer: [
    {
      command: 'npm run -s server',
      env: { HAZELLE_DATA: '.data', HAZELLE_LOCAL_PROVIDERS: FAKE_PROVIDER },
      url: 'http://localhost:8080/api/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: `./node_modules/.bin/vite --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}/`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
