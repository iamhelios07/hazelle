import type { Db, Statement } from '../db/service-db';

export function takeBackFiles(db: Db, incarnation: string, from: { ids: string[]; timeline?: string } | { snapshot: string }, at = Date.now()): [Statement, Statement, Statement] {
  const named = 'ids' in from;
  const value = named ? JSON.stringify(from.ids) : from.snapshot;
  const matches = named ? 'id IN (SELECT value FROM json_each(?2))' : 'released_at >= (SELECT taken_at FROM snapshots WHERE id = ?2 AND incarnation = ?1)';
  const timeline = named ? from.timeline : undefined;
  const current = timeline === undefined ? '' : " AND EXISTS (SELECT 1 FROM accounts WHERE incarnation = ?1 AND timeline = ?3 AND state = 'active')";
  const back = `FROM file_removals WHERE incarnation = ?1 AND removing = 0 AND ${matches}${current}`;
  const binds = [incarnation, value, ...(timeline === undefined ? [] : [timeline])];
  return [
    db.prepare(`UPDATE accounts SET file_bytes = file_bytes + (SELECT COALESCE(SUM(size), 0) ${back}) WHERE incarnation = ?1`).bind(...binds),
    db.prepare(`INSERT INTO account_files (incarnation, id, size, stored, created_at, claimed_at) SELECT incarnation, id, size, 1, created_at, ?${binds.length + 1} ${back}`).bind(...binds, at),
    // Pairs are disjoint outside the transaction; the intersection is exactly what its insert just took back.
    db.prepare('DELETE FROM file_removals WHERE incarnation = ?1 AND id IN (SELECT id FROM account_files WHERE incarnation = ?1)').bind(incarnation),
  ];
}

type Claims = { fileBytes: number; missing: number; removing: number; blocked: number };

// Called on the account queue through the object write or share publication that names these files. Reclaiming first
// is crash-safe: an interrupted write may keep extra bytes, but never publishes a reference to a released copy.
export async function claimFiles(db: Db, incarnation: string, ids: string[]): Promise<Claims> {
  const named = JSON.stringify(ids);
  const results = await db.batch<Claims>([
    ...takeBackFiles(db, incarnation, { ids }),
    db.prepare('UPDATE account_files SET claimed_at = ?3 WHERE incarnation = ?1 AND id IN (SELECT value FROM json_each(?2))').bind(incarnation, named, Date.now()),
    db.prepare(`SELECT file_bytes AS fileBytes,
      (SELECT COUNT(*) FROM json_each(?2) n WHERE NOT EXISTS (SELECT 1 FROM account_files WHERE incarnation = ?1 AND id = n.value AND stored = 1)) AS missing,
      (SELECT COUNT(*) FROM file_removals WHERE incarnation = ?1 AND removing = 1 AND id IN (SELECT value FROM json_each(?2))) AS removing,
      (SELECT COUNT(*) FROM file_blocks WHERE id IN (SELECT value FROM json_each(?2))) AS blocked
      FROM accounts WHERE incarnation = ?1`).bind(incarnation, named),
  ]);
  return results.at(-1)!.results[0]!;
}
