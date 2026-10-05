import { join } from 'node:path';
import { restoreGeneration } from './restore';

// scripts/restore.sh runs this, bundled beside node.js: node dist/server/restore-cli.js <generation> <data directory>.
const [generation, dataDir] = process.argv.slice(2);
if (!generation || !dataDir) {
  console.error('usage: restore <generation directory> <empty data directory>');
  process.exit(2);
}
// Two directories up from dist/server/restore-cli.js, as node.ts finds them.
const migrationsDir = process.env.HAZELLE_MIGRATIONS ?? join(import.meta.dirname, '..', '..', 'migrations');
try {
  console.log(JSON.stringify(await restoreGeneration(generation, dataDir, migrationsDir)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
