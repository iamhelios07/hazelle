import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { pipeline } from 'node:stream/promises';
import { parentPort, workerData } from 'node:worker_threads';
import { createGzip } from 'node:zlib';
import { fsyncPath } from './durable';
import type { ArchiveJob, SnapshotArchive } from './snapshot';

const { plain, gzip } = workerData as ArchiveJob;
const db = new DatabaseSync(plain);
try {
  // Compact only the private copy; an online backup alone would retain the live database's free pages.
  db.exec('PRAGMA journal_mode = DELETE');
  db.exec('VACUUM');
  const [check] = db.prepare('PRAGMA quick_check').all();
  if (check?.quick_check !== 'ok') throw new Error(`Snapshot failed quick_check: ${check?.quick_check}`);
} finally {
  db.close();
}

const expanded = statSync(plain).size;
const hash = createHash('sha256');
let bytes = 0;
await pipeline(createReadStream(plain), createGzip(), async function* (chunks) {
  for await (const chunk of chunks as AsyncIterable<Buffer>) {
    hash.update(chunk);
    bytes += chunk.length;
    yield chunk;
  }
}, createWriteStream(gzip));
fsyncPath(gzip);
parentPort!.postMessage({ bytes, expanded, sha256: hash.digest('hex') } satisfies SnapshotArchive);
