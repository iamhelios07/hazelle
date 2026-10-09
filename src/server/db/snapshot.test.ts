import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { serviceDb } from './service-db';
import { archiveSnapshot } from './snapshot';

it('archives an independent, compacted snapshot with hashes matching its gzip and restored contents', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hazelle-archive-'));
  const raw = new DatabaseSync(':memory:');
  try {
    raw.exec("CREATE TABLE entries (id INTEGER PRIMARY KEY, body TEXT); INSERT INTO entries VALUES (1, 'kept'), (2, zeroblob(1048576)); DELETE FROM entries WHERE id = 2");
    const plain = join(dir, 'copy.sqlite');
    const gzip = `${plain}.gz`;
    await serviceDb(raw).snapshot(plain);
    const before = statSync(plain).size;
    raw.exec("UPDATE entries SET body = 'changed'");
    const archive = await archiveSnapshot(plain, gzip);
    const bytes = readFileSync(gzip);
    expect(archive).toEqual({ bytes: bytes.length, expanded: statSync(plain).size, sha256: createHash('sha256').update(bytes).digest('hex') });
    expect(archive.expanded).toBeLessThan(before);
    const restored = join(dir, 'restored.sqlite');
    writeFileSync(restored, gunzipSync(bytes));
    const copy = new DatabaseSync(restored, { readOnly: true });
    try {
      expect(copy.prepare('SELECT * FROM entries').all()).toEqual([{ id: 1, body: 'kept' }]);
      expect(copy.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
    } finally { copy.close(); }
  } finally {
    raw.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('rejects a corrupt snapshot without publishing a gzip', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hazelle-archive-corrupt-'));
  try {
    const plain = join(dir, 'broken.sqlite');
    const gzip = `${plain}.gz`;
    writeFileSync(plain, 'not a SQLite database'.repeat(100));
    await expect(archiveSnapshot(plain, gzip)).rejects.toThrow();
    expect(existsSync(gzip)).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
