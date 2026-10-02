// One account's objects and the counters that change with them, as rules over StoreDb. The Durable Object
// (account-object.ts) runs them over workerd's storage, the tests over store-db-node.ts. Nothing here may import
// cloudflare:workers: vitest loads this file in plain Node.

export type Life = { state: 'active' | 'restoring' | 'leaving' | 'gone'; timeline: string | null; operation: number | null };
export type Unavailable = { unavailable: true };
// unavailable: the wake's D1 read failed, threw, timed out or answered something that is neither a row nor no row.
export type Refused = { refused: 'restoring' | 'leaving' | 'gone' } | Unavailable;
// file: the stored file the object names (server/files), which the server sees; a deletion names none.
export type Write = { id: string; kind: string; parent: string | null; body: string | null; baseRev: number | null; file: string | null };
export type Change = { id: string; kind: string; parent: string | null; rev: number; body?: string | null; omitted?: true };
export type FeedQuery = { timeline: string | null; since: number; known: number; until: number | null; bootstrap: boolean; metadata: boolean; excluded: string[]; parent: string | null };
export type Phase = 'begun' | 'fenced' | 'checkpointed' | 'targeted' | 'armed' | 'rewound' | 'done' | 'failed' | 'cancelled';
export type FeedPage = { timeline: string; bytes: number; until: number | null; changes: Change[]; cursor: number; more: boolean };
type WrongPhase = { wrongPhase: true };

export type SqlValue = string | number | null;

// What the rules need of a SQLite-backed Durable Object's storage. workerd refuses BEGIN, SAVEPOINT and PRAGMA in
// exec; a transaction is only transaction(fn), which rolls back when fn throws. wipe() drops every table and every
// kv key, as deleteAll() does; the bookmarks outlive it.
export type StoreDb = {
  exec<T>(sql: string, ...binds: SqlValue[]): T[];
  transaction<T>(fn: () => T): T;
  wipe(): Promise<void>;
  kv: { get(key: string): unknown; put(key: string, value: string): void; delete(key: string): boolean };
  size(): number;
  bookmarks: {
    current(): Promise<string>;
    // null: the time is before this database existed.
    forTime(at: number): Promise<string | null>;
    // Answers a bookmark of the state just before the restore, which applies when the object next starts.
    restoreOnNextSession(bookmark: string): Promise<string>;
  };
};

// The account's lifecycle, which lives in D1 where a rewind of this store cannot touch it. Each answers the row as D1
// gave it; the rules decide what a row means.
export type StoreReads = {
  life(incarnation: string): Promise<unknown>;
  phase(incarnation: string, operation: number): Promise<unknown>;
};

export const d1Reads = (db: D1Database): StoreReads => ({
  life: (incarnation) => db.prepare('SELECT state, timeline, operation FROM accounts WHERE incarnation = ?').bind(incarnation).first(),
  phase: (incarnation, operation) => db.prepare('SELECT phase FROM restores WHERE id = ? AND incarnation = ?').bind(operation, incarnation).first('phase'),
});

const PAGE_ROWS = 500;
const PAGE_BODY_LENGTH = 4_000_000;
// How far past its cap an account's updates may still grow it, so a full account can move what it means to delete to
// 지운 캐릭터 (a body that grows a little), while nothing new is created. The account's bytes never pass cap + this.
const FULL_MARGIN = 1_000_000;
// Under blockConcurrencyWhile's 30 s, past which workerd resets the object and the caller gets an exception instead
// of { unavailable }.
const READ_MS = 5_000;

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS head (id INTEGER PRIMARY KEY CHECK (id = 1), rev INTEGER NOT NULL, bytes INTEGER NOT NULL, timeline TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS objects (id TEXT PRIMARY KEY, kind TEXT NOT NULL, parent_id TEXT, rev INTEGER NOT NULL, body TEXT, deleted_at INTEGER, file_id TEXT)',
  // The global cursor stays in revision order, including omitted bodies.
  'CREATE INDEX IF NOT EXISTS objects_rev ON objects (rev, kind, parent_id, id, deleted_at)',
  'CREATE INDEX IF NOT EXISTS objects_parent_rev ON objects (parent_id, rev)',
];

type Head = { rev: number; bytes: number; timeline: string };
type Row = { id: string; kind: string; parent_id: string | null; rev: number; deleted: number; fits: number; omitted: number; body: string | null };

const unavailable = (): Unavailable => ({ unavailable: true });
const markKey = (operation: number) => `restore:${operation}`;

export class StoreRules {
  // Kept until the object restarts; never an unavailable answer, so the next call reads D1 again.
  private life: Life | null = null;

  constructor(
    private readonly db: StoreDb,
    private readonly reads: StoreReads,
    // workerd: blockConcurrencyWhile, which holds every other event until the load settles.
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
      // objects never has to fit in the Worker's memory at once. The first row always fits. Rows past the
      // budget come back without their bodies, only to tell whether more is waiting.
      // Bound candidates before the window sum; an outer LIMIT still sums the rest of the account.
      const excluded = JSON.stringify(query.excluded);
      const rows = this.db.exec<Row>(
        `SELECT id, kind, parent_id, rev, deleted_at IS NOT NULL AS deleted, omitted, start < ? AS fits, CASE WHEN start < ? THEN body END AS body
         FROM (
           SELECT *, SUM(COALESCE(LENGTH(body), 0)) OVER (ORDER BY rev) - COALESCE(LENGTH(body), 0) AS start
           FROM (
             SELECT id, kind, parent_id, rev, deleted_at,
               (kind IN (SELECT value FROM json_each(?)) OR ${query.metadata ? 1 : 0}) AND deleted_at IS NULL AS omitted,
               CASE WHEN kind NOT IN (SELECT value FROM json_each(?)) AND ${query.metadata ? 0 : 1} THEN body END AS body
             FROM objects WHERE rev > ?
               ${query.parent === null ? '' : 'AND parent_id = ?'}
               ${until === null ? '' : 'AND kind NOT IN (SELECT value FROM json_each(?)) AND rev <= ?'}
             ORDER BY rev LIMIT ?
           )
         ) ORDER BY rev`,
        ...[PAGE_BODY_LENGTH, PAGE_BODY_LENGTH, excluded, excluded, query.since],
        ...(query.parent === null ? [] : [query.parent]),
        ...(until === null ? [] : [excluded, until]),
        PAGE_ROWS + 1,
      );
      const page: Row[] = [];
      for (const row of rows) {
        if (page.length === PAGE_ROWS || !row.fits) break;
        page.push(row);
      }
      return {
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
      writes.forEach(({ id, kind, parent, body, file }, index) =>
        this.db.exec(
          `INSERT INTO objects (id, kind, parent_id, rev, body, deleted_at, file_id) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET rev = excluded.rev, body = excluded.body, deleted_at = excluded.deleted_at, file_id = excluded.file_id`,
          id, kind, parent, revs[index]!, body, body === null ? Date.now() : null, body === null ? null : file,
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
    return (await this.restoring(incarnation, operation)) ?? { checkpoint: await this.db.bookmarks.current() };
  }

  async target(incarnation: string, operation: number, from: { at: number } | { bookmark: string }): Promise<Refused | WrongPhase | { target: string } | { tooEarly: true }> {
    const refused = await this.restoring(incarnation, operation);
    if (refused) return refused;
    if ('bookmark' in from) return { target: from.bookmark };
    const target = await this.db.bookmarks.forTime(from.at);
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

  async marked(incarnation: string, operation: number): Promise<Refused | { marked: boolean }> {
    const refused = await this.stored(incarnation);
    if (refused) return refused;
    return { marked: this.db.kv.get(markKey(operation)) !== undefined };
  }

  // The phase is read from D1 inside the call: a runner that lost the arming compare-and-set, or one that arrives after
  // a cancel, must not rewind.
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
    return { returned: await this.db.bookmarks.restoreOnNextSession(target) };
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

  // Fails closed: only a read that answers no row means gone. Tables are made only for an active account, and its
  // timeline is in head before the first answer, so a fresh or just-rewound store never serves the old one.
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
      this.db.transaction(() => {
        for (const statement of SCHEMA) this.db.exec(statement);
        this.db.exec('INSERT INTO head (id, rev, bytes, timeline) VALUES (1, 0, 0, ?) ON CONFLICT (id) DO UPDATE SET timeline = excluded.timeline', life.timeline);
      });
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
    timer = setTimeout(() => reject(new Error('The D1 read took too long.')), READ_MS);
  });
  try {
    return await Promise.race([read, late]);
  } finally {
    clearTimeout(timer);
  }
}
