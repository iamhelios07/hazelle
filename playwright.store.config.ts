import { defineConfig } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { STORE_ADMIN, storeSpecWorker } from './e2e/store-harness';

const PORT = 4417;
const STATE = '.wrangler/e2e';
const WRANGLER = './node_modules/.bin/wrangler';

// The built Worker (npm run e2e builds first) wrapped by e2e/store-harness, which adds probes and an operator beside
// it. The wrapper is written under .wrangler/ and named apart from the service, and no build or deploy reads it.
function wrapped() {
  const redirect = JSON.parse(readFileSync('.wrangler/deploy/config.json', 'utf8')) as { configPath: string };
  const builtPath = resolve('.wrangler/deploy', redirect.configPath);
  const built = JSON.parse(readFileSync(builtPath, 'utf8')) as { main: string; assets: { directory: string }; vars?: Record<string, string> };
  const directory = resolve('.wrangler/store-spec');
  mkdirSync(directory, { recursive: true });
  writeFileSync(`${directory}/worker.mjs`, storeSpecWorker(resolve(dirname(builtPath), built.main)));
  writeFileSync(`${directory}/wrangler.json`, JSON.stringify({
    ...built,
    name: 'risu-alpha-store-spec',
    main: './worker.mjs',
    no_bundle: false,
    assets: { ...built.assets, directory: resolve(dirname(builtPath), built.assets.directory), run_worker_first: ['/api/*', '/__store-spec/*'] },
    vars: { ...built.vars, ADMIN_ACCOUNT: STORE_ADMIN },
  }));
  return `${directory}/wrangler.json`;
}

// e2e/store.spec.ts alone: the account stores on real workerd with local D1 and R2, asked over HTTP and RPC.
export default defineConfig({
  testDir: 'e2e',
  testMatch: 'store.spec.ts',
  workers: 1,
  reporter: 'list',
  timeout: 120_000,
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: [
      `node -e "require('node:fs').rmSync('${STATE}', { recursive: true, force: true })"`,
      `${WRANGLER} d1 migrations apply risu-alpha --local --persist-to ${STATE} -c wrangler.jsonc`,
      `${WRANGLER} dev --local --port ${PORT} --persist-to ${STATE} -c ${wrapped()}`,
    ].join(' && '),
    url: `http://localhost:${PORT}/api/session`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
