import type { AccountState } from '../contracts/admin';
import type { Db } from './db/service-db';
// The rules of one account's store over its database file (db/account-db.ts); nothing here touches a file directly.

export type Life = { state: AccountState | 'gone'; timeline: string | null; operation: number | null };
export type Unavailable = { unavailable: true };
// unavailable: the wake's service read failed, timed out or answered something that is neither a row nor no row, or
// the account's file is missing, corrupt or of a newer schema.
export type Refused = { refused: 'restoring' | 'leaving' | 'gone' } | Unavailable;
export type Write = { id: string; kind: string; parent: string | null; body: string | null; baseRev: number | null };
export type Change = { id: string; kind: string; parent: string | null; rev: number; body?: string | null; omitted?: true };
// count: the first page of a bootstrap asks how many changes the whole bootstrap holds, for a bar.
export type FeedQuery = { timeline: string | null; since: number; known: number; until: number | null; bootstrap: boolean; metadata: boolean; excluded: string[]; parent: string | null; kind: string | null; count: boolean };
export type FeedPage = { timeline: string; bytes: number; until: number | null; changes: Change[]; cursor: number; more: boolean; total?: number };
type WrongPhase = { wrongPhase: true };

export type SqlValue = string | number | null;

// transaction(fn) rolls back when fn throws. wipe() deletes the file, kv included; the snapshots outlive it. A
// snapshot is a point-in-time copy of the file, catalogued in the service database; an armed restore installs one
// when the store next starts (db/account-db.ts).
export type StoreDb = {
  exec<T>(sql: string, ...binds: SqlValue[]): T[];
  transaction<T>(fn: () => T): T;
  wipe(): Promise<void>;
  kv: { get(key: string): unknown; put(key: string, value: string): void; delete(key: string): boolean };
  size(): number;
  snapshots: {
    // Answers the snapshot's id once its file is durable and catalogued.
    take(kind: 'baseline' | 'checkpoint', operation: number | null): Promise<string>;
    // The snapshot a rewind to the time lands on (db/account-db.ts snapshotFor); null when there is none.
    forTime(at: number): Promise<string | null>;
    // Throws when the snapshot's file is gone or no longer what its catalog row recorded.
    verify(id: string): Promise<void>;
  };
};

// The account's lifecycle, which lives in the service database where a rewind of this store cannot touch it. Each
// answers the row as read; the rules decide what a row means.
export type StoreReads = {
  life(incarnation: string): Promise<unknown>;
  phase(incarnation: string, operation: number): Promise<unknown>;
};

export const serviceReads = (db: Db): StoreReads => ({
  life: (incarnation) => db.prepare('SELECT state, timeline, operation FROM accounts WHERE incarnation = ?').bind(incarnation).first(),
  phase: (incarnation, operation) => db.prepare('SELECT phase FROM restores WHERE id = ? AND incarnation = ?').bind(operation, incarnation).first('phase'),
});

const PAGE_ROWS = 500;
// A metadata row is a hundred bytes, so a backup's walk over a whole account takes few round trips.
const METADATA_PAGE_ROWS = 10_000;
const PAGE_BODY_BYTES = 4_000_000;
// How far past its cap an account's updates may still grow it, so a full account can still mark what it means to delete
// (휴지통's mark: a body that grows a little), while nothing new is created. The account's bytes never
// pass cap + this.
const FULL_MARGIN = 1_000_000;
// A service read that has not settled by then answers unavailable instead of holding the account's queue.
const READ_MS = 5_000;

type Head = { rev: number; bytes: number; timeline: string };
type Row = { id: string; kind: string; parent_id: string | null; rev: number; deleted: number; fits: number; omitted: number; body: string | null };

const unavailable = (): Unavailable => ({ unavailable: true });
const markKey = (operation: number) => `restore:${operation}`;

export class StoreRules {
  // Kept until the object restarts; never an unavailable answer, so the next call reads the service again.
  private life: Life | null = null;

  constructor(
    private readonly db: StoreDb,
    private readonly reads: StoreReads,
    // Holds every other call of this store until the load settles.
    private readonly exclusive: <T>(work: () => Promise<T>) => Promise<T>,
  ) {}

  status(incarnation: string): Promise<Life | Unavailable> {
    return this.lifecycle(incarnation);
  }

  async feed(incarnation: string, query: FeedQuery): Promise<Refused | { stale: true } | { reset: true } | FeedPage> {
    const life = await this.lifecycle(incarnation);
    if (!active(life)) return refusal(life);
    return this.db.transaction(() => {
      const head = this.head();
      // No timeline: a device that holds nothing yet, and only its first page may come without one.
      if (query.timeline === null ? query.since !== 0 || query.known !== 0 : query.timeline !== head.timeline) return { stale: true };
      const until = query.bootstrap ? (query.until ?? head.rev) : null;
      // An operator wipe/restore can move revisions backwards. Never merge that account with a newer device snapshot.
      if (Math.max(query.since, query.known, until ?? 0) > head.rev) return { reset: true };
      // A page stops at a row count or a body budget, whichever comes first, so a sync of many large
      // objects never has to fit in the process's memory at once. The first row always fits. Rows past the
      // budget come back without their bodies, only to tell whether more is waiting.
      // Bound candidates before the window sum; an outer LIMIT still sums the rest of the account.
      // The budget is bytes: LENGTH(body) counts characters and stops at a NUL, so a page could pass the budget.
      const excluded = JSON.stringify(query.excluded);
      const pageRows = query.metadata ? METADATA_PAGE_ROWS : PAGE_ROWS;
      const rows = this.db.exec<Row>(
        `SELECT id, kind, parent_id, rev, deleted_at IS NOT NULL AS deleted, omitted, start < ? AS fits, CASE WHEN start < ? THEN body END AS body
         FROM (
           SELECT *, SUM(size) OVER (ORDER BY rev) - size AS start
           FROM (SELECT *, COALESCE(LENGTH(CAST(body AS BLOB)), 0) AS size
           FROM (
             SELECT id, kind, parent_id, rev, deleted_at,
               (kind IN (SELECT value FROM json_each(?)) OR ${query.metadata ? 1 : 0}) AND deleted_at IS NULL AS omitted,
               CASE WHEN kind NOT IN (SELECT value FROM json_each(?)) AND ${query.metadata ? 0 : 1} THEN body END AS body
             FROM objects WHERE rev > ?
               ${query.parent === null ? '' : 'AND parent_id = ?'}
               ${query.kind === null ? '' : 'AND kind = ?'}
               ${until === null ? '' : 'AND kind NOT IN (SELECT value FROM json_each(?)) AND rev <= ?'}
             ORDER BY rev LIMIT ?
           ))
         ) ORDER BY rev`,
        ...[PAGE_BODY_BYTES, PAGE_BODY_BYTES, excluded, excluded, query.since],
        ...(query.parent === null ? [] : [query.parent]),
        ...(query.kind === null ? [] : [query.kind]),
        ...(until === null ? [] : [excluded, until]),
        pageRows + 1,
      );
      const page: Row[] = [];
      for (const row of rows) {
        if (page.length === pageRows || !row.fits) break;
        page.push(row);
      }
      const total = query.count && until !== null
        ? this.db.exec<{ n: number }>(
          `SELECT COUNT(*) AS n FROM objects WHERE rev > ? AND rev <= ? AND kind NOT IN (SELECT value FROM json_each(?))${query.parent === null ? '' : ' AND parent_id = ?'}${query.kind === null ? '' : ' AND kind = ?'}`,
          query.since, until, excluded, ...(query.parent === null ? [] : [query.parent]), ...(query.kind === null ? [] : [query.kind]),
        )[0]!.n
        : undefined;
      return {
        ...(total === undefined ? {} : { total }),
        timeline: head.timeline,
        bytes: head.bytes,
        until,
        changes: page.map((row): Change => ({ id: row.id, kind: row.kind, parent: row.parent_id, rev: row.rev, ...(row.omitted ? { omitted: true } : { body: row.deleted ? null : row.body }) })),
        cursor: page.at(-1)?.rev ?? query.since,
        more: rows.length > page.length,
      };
    });
  }

  // Every write in a batch takes the account's next rev, in the order given, in one transaction. An update keeps
  // the object's parent: one naming another parent is bad input, not a conflict, since pulling and trying again could
  // never make it fit. A deleted object stays as a row without a body, so other devices learn of the deletion by sync;
  // writing it again with its current rev restores it (되돌리기).
  // The same transaction keeps head.bytes, the bytes of the account's bodies, and holds it under the cap the request
  // read with its session: a batch that creates an object must fit under it, one that only changes or deletes objects
  // under it plus FULL_MARGIN, and one that does not grow the account always passes, so a full account can still delete.
  // A null cap is no cap.
  async batch(incarnation: string, timeline: string, writes: Write[], cap: number | null): Promise<Refused | { stale: true } | { refused: 'bad-input' | 'conflict' | 'storage-full' } | { revs: number[]; bytes: number; timeline: string }> {
    const life = await this.lifecycle(incarnation);
    if (!active(life)) return refusal(life);
    // No read outside this transaction decides whether to write; a later item's conflict must leave even head.rev
    // untouched.
    return this.db.transaction(() => {
      const head = this.head();
      if (timeline !== head.timeline) return { stale: true };
      const checks = JSON.stringify(writes.map(({ id, kind, parent, baseRev, body }) => ({ id, kind, parent, baseRev, remove: body === null })));
      const moved = `o.id IS NOT NULL AND o.parent_id IS NOT json_extract(w.value, '$.parent')`;
      // replaced: the bytes of the bodies these writes replace, counted as the migration counted them.
      const [found] = this.db.exec<{ moved: number; conflict: number; replaced: number }>(
        `SELECT
           MAX(json_extract(w.value, '$.baseRev') IS NOT NULL AND ${moved}) AS moved,
           MAX(CASE WHEN json_extract(w.value, '$.baseRev') IS NULL THEN o.id IS NOT NULL
             ELSE o.id IS NULL OR o.kind != json_extract(w.value, '$.kind')
               OR o.rev != json_extract(w.value, '$.baseRev') OR ${moved}
               OR (json_extract(w.value, '$.remove') AND o.body IS NULL) END) AS conflict,
           COALESCE(SUM(LENGTH(CAST(o.body AS BLOB))), 0) AS replaced
         FROM json_each(?) AS w LEFT JOIN objects AS o ON o.id = json_extract(w.value, '$.id')`,
        checks,
      );
      if (found!.moved) return { refused: 'bad-input' };
      if (found!.conflict) return { refused: 'conflict' };
      const encoder = new TextEncoder();
      const added = writes.reduce((sum, { body }) => sum + (body === null ? 0 : encoder.encode(body).length), 0);
      const bytes = head.bytes + added - found!.replaced;
      const margin = writes.some(({ baseRev }) => baseRev === null) ? 0 : FULL_MARGIN;
      if (added > found!.replaced && cap !== null && bytes > cap + margin) return { refused: 'storage-full' };
      this.db.exec('UPDATE head SET rev = ?, bytes = ?', head.rev + writes.length, bytes);
      const revs = writes.map((_, index) => head.rev + index + 1);
      writes.forEach(({ id, kind, parent, body }, index) =>
        this.db.exec(
          `INSERT INTO objects (id, kind, parent_id, rev, body, deleted_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET rev = excluded.rev, body = excluded.body, deleted_at = excluded.deleted_at`,
          id, kind, parent, revs[index]!, body, body === null ? Date.now() : null,
        ),
      );
      return { revs, bytes, timeline: head.timeline };
    });
  }

  async usage(incarnation: string): Promise<Refused | { bytes: number; disk: number }> {
    const life = await this.lifecycle(incarnation);
    if (!active(life)) return refusal(life);
    return { bytes: this.head().bytes, disk: this.db.size() };
  }

  async checkpoint(incarnation: string, operation: number): Promise<Refused | WrongPhase | { checkpoint: string }> {
    return (await this.restoring(incarnation, operation)) ?? { checkpoint: await this.db.snapshots.take('checkpoint', operation) };
  }

  async target(incarnation: string, operation: number, from: { at: number } | { snapshot: string }): Promise<Refused | WrongPhase | { target: string } | { tooEarly: true }> {
    const refused = await this.restoring(incarnation, operation);
    if (refused) return refused;
    if ('snapshot' in from) {
      await this.db.snapshots.verify(from.snapshot);
      return { target: from.snapshot };
    }
    const target = await this.db.snapshots.forTime(from.at);
    return target === null ? { tooEarly: true } : { target };
  }

  async mark(incarnation: string, operation: number): Promise<Refused | WrongPhase | { marked: true }> {
    const refused = await this.restoring(incarnation, operation);
    if (refused) return refused;
    this.db.kv.put(markKey(operation), 'marked');
    return { marked: true };
  }

  // The mark is the operation's own key, so reading or deleting it is safe whichever operation holds the account, and
  // a cancel deletes it after the account is active again.
  async unmark(incarnation: string, operation: number): Promise<Refused | { unmarked: true }> {
    const refused = await this.stored(incarnation);
    if (refused) return refused;
    this.db.kv.delete(markKey(operation));
    return { unmarked: true };
  }

  // installedFrom, installedOp: the snapshot the file was installed from and the operation that installed it, which with
  // the mark's absence prove the rewind applied; the mark alone proves nothing, since a file installed from before the
  // mark never held it.
  async marked(incarnation: string, operation: number): Promise<Refused | { marked: boolean; installedFrom: string | null; installedOp: number | null }> {
    const refused = await this.stored(incarnation);
    if (refused) return refused;
    const [head] = this.db.exec<{ installed_from: string | null; installed_op: number | null }>('SELECT installed_from, installed_op FROM head');
    return { marked: this.db.kv.get(markKey(operation)) !== undefined, installedFrom: head?.installed_from ?? null, installedOp: head?.installed_op ?? null };
  }

  // The phase is read from the service inside the call: a runner that lost the arming compare-and-set, or one that
  // arrives after a cancel, must not rewind. The instruction itself is the operation's row at phase armed; the install
  // happens when the store next starts (db/account-db.ts), so this only confirms it may.
  async arm(incarnation: string, operation: number, target: string): Promise<Refused | WrongPhase | { returned: string }> {
    const refused = await this.restoring(incarnation, operation);
    if (refused) return refused;
    let phase: unknown;
    try {
      phase = await settles(this.reads.phase(incarnation, operation));
    } catch {
      return unavailable();
    }
    if (phase !== 'armed') return { wrongPhase: true };
    return { returned: target };
  }

  async destroy(incarnation: string): Promise<Refused | { destroyed: true }> {
    const life = await this.lifecycle(incarnation);
    if ('unavailable' in life) return life;
    if (life.state === 'active') throw new Error('destroy() empties only a leaving account.');
    if (life.state !== 'leaving') return { refused: life.state };
    await this.db.wipe();
    return { destroyed: true };
  }

  private head() {
    return this.db.exec<Head>('SELECT rev, bytes, timeline FROM head')[0]!;
  }

  private async lifecycle(incarnation: string): Promise<Life | Unavailable> {
    return this.life ?? this.exclusive(async () => this.life ?? this.load(incarnation));
  }

  // Fails closed: only a read that answers no row means gone. The file was made by the signup or installed by a
  // rewind, never here: an active account whose file is missing or unreadable is unavailable, not empty. Its timeline
  // is in head before the first answer, so a just-rewound store never serves the old one.
  private async load(incarnation: string): Promise<Life | Unavailable> {
    let row: unknown;
    try {
      row = await settles(this.reads.life(incarnation));
    } catch {
      return unavailable();
    }
    const life = row === null ? { state: 'gone' as const, timeline: null, operation: null } : readLife(row);
    if (!life) return unavailable();
    if (life.state === 'active') {
      try {
        if (this.db.exec<{ n: number }>('UPDATE head SET timeline = ? WHERE id = 1 RETURNING 1 AS n', life.timeline).length !== 1) return unavailable();
      } catch {
        return unavailable();
      }
    }
    this.life = life;
    return life;
  }

  private async restoring(incarnation: string, operation: number): Promise<Refused | WrongPhase | null> {
    const life = await this.lifecycle(incarnation);
    if ('unavailable' in life) return life;
    if (life.state === 'leaving' || life.state === 'gone') return { refused: life.state };
    return life.state === 'restoring' && life.operation === operation ? null : { wrongPhase: true };
  }

  private async stored(incarnation: string): Promise<Refused | null> {
    const life = await this.lifecycle(incarnation);
    if ('unavailable' in life) return life;
    return life.state === 'leaving' || life.state === 'gone' ? { refused: life.state } : null;
  }
}

function active(life: Life | Unavailable): life is Life & { state: 'active' } {
  return !('unavailable' in life) && life.state === 'active';
}

function refusal(life: Life | Unavailable): Refused {
  return 'unavailable' in life ? life : { refused: life.state as 'restoring' | 'leaving' | 'gone' };
}

function readLife(row: unknown): Life | null {
  if (typeof row !== 'object' || row === null) return null;
  const { state, timeline, operation } = row as Record<string, unknown>;
  if (state !== 'active' && state !== 'restoring' && state !== 'leaving') return null;
  if (typeof timeline !== 'string' || (operation !== null && !Number.isSafeInteger(operation))) return null;
  return { state, timeline, operation: operation as number | null };
}

async function settles<T>(read: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('The service read took too long.')), READ_MS);
  });
  try {
    return await Promise.race([read, late]);
  } finally {
    clearTimeout(timer);
  }
}
