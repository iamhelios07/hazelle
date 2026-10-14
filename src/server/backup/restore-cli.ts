import { join } from 'node:path';
import { chooseBucket } from '../files/choose';
import { restoreGeneration } from './restore';

// scripts/restore.sh runs this, bundled beside node.js: node dist/server/restore-cli.js <generation> <data directory>.
// The picture and snapshot store is the one the environment names, as for the server that will run on the directory.
const [generation, dataDir, source] = process.argv.slice(2);
if (!generation || !dataDir || (source !== undefined && source !== '--snapshots-from-store')) {
  console.error('usage: restore <generation directory> <empty data directory> [--snapshots-from-store]');
  process.exit(2);
}
// Two directories up from dist/server/restore-cli.js, as node.ts finds them.
const migrationsDir = process.env.HAZELLE_MIGRATIONS ?? join(import.meta.dirname, '..', '..', 'migrations');
try {
  console.log(JSON.stringify(await restoreGeneration(generation, dataDir, migrationsDir, chooseBucket(process.env, dataDir), source === '--snapshots-from-store')));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
