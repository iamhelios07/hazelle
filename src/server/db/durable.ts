import { createHash } from 'node:crypto';
import { closeSync, createReadStream, fsyncSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

// What account files, snapshots and backup generations share to make a file durable before a row or a manifest names
// it (README.md), and to check one against what was recorded of it.

export function fsyncPath(path: string): void {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

// mkdir -p whose new names survive a power loss: every directory it made is synced into its parent before this
// returns. The entries the caller then puts in the deepest one are the caller's to sync.
export function makeDirs(dir: string): void {
  const created = mkdirSync(dir, { recursive: true });
  if (created === undefined) return;
  const made = [resolve(created)];
  for (const name of relative(made[0]!, resolve(dir)).split(sep).filter(Boolean)) made.push(join(made.at(-1)!, name));
  for (const path of made) fsyncPath(dirname(path));
}

export async function digest(path: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest('hex'), bytes };
}
