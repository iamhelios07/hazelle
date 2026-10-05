import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

// Applies migrations/*.sql in name order, each whole file in one transaction with its ledger row. The ledger must be an
// ordered prefix of the files this build ships: a changed applied file, a ledger row this build does not know (a
// newer database under an older build), a gap, or a missing directory stops the process before it serves. Nothing is
// ever downgraded.
export function migrate(db: DatabaseSync, directory: string): { applied: string[] } {
  let names: string[];
  try {
    names = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();
  } catch {
    throw new Error(`migrations: cannot read ${directory}`);
  }
  if (!names.length) throw new Error(`migrations: no .sql files in ${directory}`);
  db.exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)');
  const ledger = db.prepare('SELECT name, checksum FROM migrations ORDER BY rowid').all() as { name: string; checksum: string }[];
  const files = names.map((name) => {
    const sql = readFileSync(join(directory, name), 'utf8');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
  ledger.forEach((row, index) => {
    const file = files[index];
    if (!file || file.name !== row.name) throw new Error(`migrations: the database applied ${row.name} at position ${index + 1}, which this build does not ship there`);
    if (file.checksum !== row.checksum) throw new Error(`migrations: ${row.name} changed after it was applied`);
  });
  const applied: string[] = [];
  for (const file of files.slice(ledger.length)) {
    db.exec('BEGIN');
    try {
      db.exec(file.sql);
      db.prepare('INSERT INTO migrations (name, checksum, applied_at) VALUES (?, ?, ?)').run(file.name, file.checksum, Date.now());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`migrations: ${file.name} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    applied.push(file.name);
  }
  return { applied };
}
