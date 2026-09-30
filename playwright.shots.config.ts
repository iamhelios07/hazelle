import { defineConfig } from '@playwright/test';

const PORT = 5180;

// Screenshot scripts in shots/ (not tracked), against the dev server and its own lasting local state, where the
// account of e2e/shots.ts stays signed up. Unlike playwright.config.ts nothing is wiped between runs.
export default defineConfig({
  testDir: 'shots',
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `./node_modules/.bin/vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/api/session`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
