import { createHash } from 'node:crypto';
import { closeSync, createReadStream, fsyncSync, openSync } from 'node:fs';

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

export async function digest(path: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest('hex'), bytes };
}
