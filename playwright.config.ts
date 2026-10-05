import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FAKE_PROVIDER } from './e2e/helpers';

const PORT = 4417;
// The first signup claims the installation and closes signup, so every run starts the built server (npm run e2e
// builds first) on an empty data directory of its own, apart from the .data/ that npm run dev uses.
const DATA = join(tmpdir(), 'hazelle-e2e');

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  reporter: 'list',
  timeout: 120_000,
  use: { baseURL: `http://localhost:${PORT}` },
  // e2e/store.spec.ts starts, kills and restarts a server of its own, on another port and directory.
  webServer: {
    command: `node -e "require('node:fs').rmSync('${DATA}', { recursive: true, force: true })" && node dist/server/node.js`,
    env: { HAZELLE_DATA: DATA, HAZELLE_CLIENT: 'dist/client', PORT: String(PORT), HAZELLE_LOCAL_PROVIDERS: FAKE_PROVIDER },
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
