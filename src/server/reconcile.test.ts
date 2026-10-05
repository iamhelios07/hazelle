import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { serviceDb } from './db/service-db';
import { reconcile } from './reconcile';

const NOW = 1_800_000_000_000;
const OLD = (NOW - 2 * 60 * 60 * 1000) / 1000;
const FRESH = (NOW - 60 * 1000) / 1000;
const LIVE = 'a'.repeat(32);
const GONE = 'b'.repeat(32);
const NEW = 'c'.repeat(32);
const ID = 'd'.repeat(64);

let dir = '';
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setup() {
  dir = mkdtempSync(join(tmpdir(), 'hazelle-'));
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync('migrations/0001_baseline.sql', 'utf8'));
  raw.prepare("INSERT INTO accounts (id, username, login_hash, created_at, incarnation, timeline) VALUES ('u', 'jin', 'h', 1, ?, 't')").run(LIVE);
  raw.prepare("INSERT INTO snapshots (id, incarnation, kind, taken_at, rev, bytes, expanded, sha256) VALUES ('kept', ?, 'k', 1, 0, 1, 1, 's')").run(LIVE);
  return serviceDb(raw);
}

// Files first, then their directories, so a directory's own mtime is the one set here.
function place(entries: [string, number][]) {
  for (const [path] of entries) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    if (!path.endsWith('/')) writeFileSync(join(dir, path), 'x');
  }
  for (const [path, at] of [...entries].sort(([a], [b]) => b.length - a.length)) utimesSync(join(dir, path), at, at);
}

describe('reconcile', () => {
  it('answers nothing on a fresh install', async () => {
    expect(await reconcile(join(tmpdir(), 'hazelle-none'), setup(), NOW)).toEqual({ removed: [] });
  });

  it("removes an orphan's pictures at any age and an old orphan's database, keeps a fresh orphan's database and a live account even when old", async () => {
    const db = setup();
    place([
      [`files/${LIVE}/${ID}`, OLD],
      [`files/${LIVE}/.tmp-1`, OLD],
      [`files/${LIVE}/.tmp-2`, FRESH],
      [`files/${LIVE}/`, OLD],
      [`files/${GONE}/${ID}`, OLD],
      [`files/${GONE}/`, OLD],
      [`files/${NEW}/${ID}`, FRESH],
      [`files/${NEW}/`, FRESH],
      [`accounts/${LIVE}.sqlite`, OLD],
      [`accounts/${LIVE}.sqlite-wal`, OLD],
      [`accounts/${GONE}.sqlite`, OLD],
      [`accounts/${GONE}.sqlite-wal`, OLD],
      [`accounts/${NEW}.sqlite`, OLD],
      [`accounts/${NEW}.sqlite-wal`, FRESH],
      [`accounts/${LIVE}.install-x.sqlite`, OLD],
      [`accounts/${NEW}.install-y.sqlite`, FRESH],
    ]);
    const { removed } = await reconcile(dir, db, NOW);
    expect(removed.sort()).toEqual(
      [`files/${LIVE}/.tmp-1`, `files/${GONE}`, `files/${NEW}`, `accounts/${GONE}.sqlite`, `accounts/${GONE}.sqlite-wal`, `accounts/${LIVE}.install-x.sqlite`].sort(),
    );
  });

  it('removes an old uncatalogued snapshot and its emptied directory, and keeps a catalogued or fresh one', async () => {
    const db = setup();
    place([
      [`snapshots/${LIVE}/kept.sqlite.gz`, OLD],
      [`snapshots/${LIVE}/stray.sqlite.gz`, OLD],
      [`snapshots/${LIVE}/young.sqlite.gz`, FRESH],
      [`snapshots/${LIVE}/`, OLD],
      [`snapshots/${GONE}/stray.sqlite.gz`, OLD],
      [`snapshots/${GONE}/`, OLD],
    ]);
    const { removed } = await reconcile(dir, db, NOW);
    expect(removed.sort()).toEqual([`snapshots/${GONE}`, `snapshots/${GONE}/stray.sqlite.gz`, `snapshots/${LIVE}/stray.sqlite.gz`].sort());
  });
});
