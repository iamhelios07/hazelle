import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreRules, type FeedQuery, type StoreDb, type StoreReads, type Write } from './account-store';
import { NodeStoreDb, nodeStores } from './store-db-node';

const INC = 'a'.repeat(32);
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

const active = (timeline = 't1') => ({ state: 'active', timeline, operation: null });
const restoring = (operation: number) => ({ state: 'restoring', timeline: 't1', operation });

let row: unknown;
let phase: unknown;
let now: number;
let reads: StoreReads;
let stores: ReturnType<typeof nodeStores>;
const store = () => stores.getByName(INC);
const restart = () => expect(store().restart(INC)).rejects.toThrow();

beforeEach(() => {
  row = active();
  phase = null;
  now = 1_000_000;
  reads = { life: vi.fn(async () => row), phase: vi.fn(async () => phase) };
  stores = nodeStores(reads, () => now);
});

const put = (id: string, input: Partial<Write> = {}): Write => ({ id, kind: 'chat', parent: null, body: 'x', baseRev: null, file: null, ...input });
const write = (input: Write | Write[], cap: number | null = null, timeline = 't1') => store().batch(INC, timeline, Array.isArray(input) ? input : [input], cap);
const query = (input: Partial<FeedQuery> = {}): FeedQuery => ({ timeline: 't1', since: 0, known: 0, until: null, bootstrap: false, metadata: false, excluded: [], parent: null, ...input });
const feed = (input: Partial<FeedQuery> = {}) => store().feed(INC, query(input));
const revs = async (input: Partial<FeedQuery> = {}) => ((await feed(input)) as { changes: { rev: number }[] }).changes.map(({ rev }) => rev);

describe('feed', () => {
  it('pages by body budget, admitting the row that crosses it, and by row count with a lookahead and no empty last page', async () => {
    const big = 'x'.repeat(1_400_000);
    for (const id of [A, B, C, crypto.randomUUID()]) await write(put(id, { kind: 'entry', body: big }));
    expect(await feed()).toMatchObject({ cursor: 3, more: true });
    expect(await revs()).toEqual([1, 2, 3]);
    expect(await feed({ since: 3 })).toMatchObject({ cursor: 4, more: false });

    const many = Array.from({ length: 2000 }, (_, index) => put(`${String(index + 5).padStart(8, '0')}-1111-4111-8111-111111111111`, { kind: 'entry', body: `body-${index + 5}` }));
    await write(many);
    const page = (await feed({ since: 504 })) as { changes: { rev: number; body?: string | null }[]; cursor: number; more: boolean };
    expect(page.changes.map(({ rev }) => rev)).toEqual(Array.from({ length: 500 }, (_, index) => 505 + index));
    expect(page.changes[0]!.body).toBe('body-505');
    expect(page).toMatchObject({ cursor: 1004, more: true });
    expect(await feed({ since: 1504 })).toMatchObject({ cursor: 2004, more: false });
    expect(await feed({ since: 2004 })).toMatchObject({ changes: [], cursor: 2004, more: false });
  });

  it('bootstraps up to until without scoped kinds, feeds omitted and deleted rows, and reads only the asked parent', async () => {
    const [D, E, F] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    await write(put(A, { body: 'chat-a' }));
    await write(put(B, { kind: 'entry', parent: A, body: 'entry-a' }));
    await write(put(C, { kind: 'memory', parent: A, body: 'memory-a' }));
    await write(put(D, { body: 'chat-b' }));
    await write(put(E, { kind: 'entry', parent: D, body: 'entry-b' }));
    const scoped = ['entry', 'memory'];
    expect(await feed({ timeline: null, bootstrap: true, excluded: scoped })).toMatchObject({ timeline: 't1', until: 5, more: false, changes: [
      { id: A, kind: 'chat', body: 'chat-a' }, { id: D, kind: 'chat', body: 'chat-b' },
    ] });
    expect(await revs({ bootstrap: true, until: 3, excluded: scoped })).toEqual([1]);
    expect(await feed({ bootstrap: true, until: 6 })).toEqual({ reset: true });

    await write(put(B, { kind: 'entry', parent: A, body: 'new-entry', baseRev: 2 }));
    await write(put(C, { kind: 'memory', parent: A, body: null, baseRev: 3 }));
    await write(put(F, { kind: 'summary', parent: A, body: 'new-summary' }));
    const later = await feed({ since: 5, excluded: scoped });
    expect(later).toMatchObject({ until: null, cursor: 8, more: false, changes: [
      { id: B, kind: 'entry', parent: A, rev: 6, omitted: true },
      { id: C, kind: 'memory', parent: A, rev: 7, body: null },
      { id: F, kind: 'summary', parent: A, rev: 8, body: 'new-summary' },
    ] });
    expect(JSON.stringify(later)).not.toContain('new-entry');
    expect(await feed({ parent: A })).toMatchObject({ changes: [{ id: B, body: 'new-entry' }, { id: C, body: null }, { id: F, body: 'new-summary' }] });
    expect(await feed({ metadata: true, since: 7 })).toMatchObject({ changes: [{ id: F, omitted: true }] });
  });

  it('answers reset for a cursor past the head', async () => {
    await write(put(A));
    expect(await feed({ since: 2 })).toEqual({ reset: true });
    expect(await feed({ known: 2 })).toEqual({ reset: true });
  });
});

describe('batch', () => {
  it('creates, updates by rev, refuses conflicts and moves, deletes and undeletes', async () => {
    expect(await write(put(A, { kind: 'settings', body: 'one' }))).toEqual({ revs: [1], bytes: 3, timeline: 't1' });
    expect(await write(put(A, { kind: 'settings', body: 'two', baseRev: 1 }))).toMatchObject({ revs: [2] });
    expect(await write(put(A, { kind: 'settings', body: 'old', baseRev: 1 }))).toEqual({ refused: 'conflict' });
    expect(await write(put(A, { kind: 'settings', body: 'again' }))).toEqual({ refused: 'conflict' });
    expect(await write(put(A, { kind: 'connection', body: 'kind', baseRev: 2 }))).toEqual({ refused: 'conflict' });
    expect(await write(put(B, { body: 'none', baseRev: 1 }))).toEqual({ refused: 'conflict' });

    await write(put(B, { kind: 'chat', body: 'b' }));
    expect(await write(put(C, { kind: 'entry', parent: A, body: 'c' }))).toMatchObject({ revs: [4] });
    expect(await write(put(C, { kind: 'entry', parent: B, body: 'moved', baseRev: 4 }))).toEqual({ refused: 'bad-input' });
    expect(await write(put(C, { kind: 'entry', parent: null, body: 'moved', baseRev: 4 }))).toEqual({ refused: 'bad-input' });

    expect(await write(put(C, { kind: 'entry', parent: A, body: null, baseRev: 3 }))).toEqual({ refused: 'conflict' });
    expect(await write(put(C, { kind: 'entry', parent: A, body: null, baseRev: 4 }))).toMatchObject({ revs: [5] });
    expect(await write(put(C, { kind: 'entry', parent: A, body: null, baseRev: 5 }))).toEqual({ refused: 'conflict' });
    expect(await feed({ since: 4 })).toMatchObject({ changes: [{ id: C, rev: 5, body: null }] });
    expect(await write(put(C, { kind: 'entry', parent: A, body: 'back', baseRev: 5 }))).toMatchObject({ revs: [6] });
    expect(await feed({ since: 5 })).toMatchObject({ changes: [{ id: C, parent: A, rev: 6, body: 'back' }] });
  });

  it('writes nothing, not even the head, when a later item conflicts', async () => {
    await write(put(A, { body: 'original' }));
    const first = put(B, { kind: 'entry', parent: A, body: 'new' });
    expect(await write([first, put(A, { body: 'changed', baseRev: 2 })])).toEqual({ refused: 'conflict' });
    expect(await write([first, put(A, { body: 'changed', parent: B, baseRev: 1 })])).toEqual({ refused: 'bad-input' });
    expect(await feed()).toMatchObject({ bytes: 8, cursor: 1, changes: [{ id: A, rev: 1, body: 'original' }] });
    expect(await write([first, put(A, { body: 'changed', baseRev: 1 })])).toMatchObject({ revs: [2, 3] });
  });

  it('holds UTF-8 bytes under the cap, lets updates grow within the margin, and lets a full account delete', async () => {
    await write(put(A, { kind: 'settings', body: '가'.repeat(10) }));
    expect(await write(put(B, { body: 'x'.repeat(20) }))).toMatchObject({ bytes: 50 });
    expect(await write(put(C, { body: 'x' }), 50)).toEqual({ refused: 'storage-full' });
    expect(await write(put(A, { kind: 'settings', body: '가'.repeat(11), baseRev: 1 }), 50)).toMatchObject({ revs: [3], bytes: 53 });
    expect(await write(put(A, { kind: 'settings', body: 'x'.repeat(1_000_051), baseRev: 3 }), 50)).toEqual({ refused: 'storage-full' });
    expect(await write([put(A, { kind: 'settings', body: 'x'.repeat(40), baseRev: 3 }), put(C, { body: 'x' })], 50)).toEqual({ refused: 'storage-full' });
    expect(await write(put(B, { body: null, baseRev: 2 }), 0)).toMatchObject({ revs: [4], bytes: 33 });
    expect(await write(put(C, { body: 'x'.repeat(17) }), 50)).toMatchObject({ bytes: 50 });
    expect(await write(put(C, { body: 'y'.repeat(17), baseRev: 5 }), 0)).toMatchObject({ bytes: 50 });
    expect(await store().usage(INC)).toMatchObject({ bytes: 50 });
  });
});

describe('timeline', () => {
  it('refuses a stale timeline on feed and batch, and a missing one past a fresh bootstrap', async () => {
    await write(put(A));
    expect(await write(put(B), null, 'old')).toEqual({ stale: true });
    expect(await feed({ timeline: 'old' })).toEqual({ stale: true });
    expect(await feed({ timeline: null, since: 1 })).toEqual({ stale: true });
    expect(await feed({ timeline: null, known: 1 })).toEqual({ stale: true });
    expect(await feed()).toMatchObject({ cursor: 1, timeline: 't1' });
  });

  it('checks the timeline in the transaction that reads or writes', async () => {
    const db = new NodeStoreDb(() => now);
    const outside: string[] = [];
    let open = false;
    const spy: StoreDb = {
      exec: (sql, ...binds) => {
        if (!open) outside.push(sql);
        return db.exec(sql, ...binds);
      },
      transaction: (fn) => db.transaction(() => {
        open = true;
        try {
          return fn();
        } finally {
          open = false;
        }
      }),
      wipe: () => db.wipe(),
      kv: db.kv,
      size: () => db.size(),
      bookmarks: db.bookmarks,
    };
    const rules = new StoreRules(spy, reads, (work) => work());
    expect(await rules.batch(INC, 't1', [put(A)], null)).toMatchObject({ revs: [1] });
    expect(await rules.batch(INC, 'old', [put(B)], null)).toEqual({ stale: true });
    expect(await rules.feed(INC, query({ timeline: 'old' }))).toEqual({ stale: true });
    expect(await rules.feed(INC, query())).toMatchObject({ cursor: 1 });
    expect(outside).toEqual([]);
  });

  it('installs the account timeline at wake, before the first answer', async () => {
    await write(put(A));
    row = active('t2');
    await restart();
    expect(await store().status(INC)).toEqual(active('t2'));
    expect(stores.db(INC).exec('SELECT timeline FROM head')).toEqual([{ timeline: 't2' }]);
    expect(await write(put(B), null, 't1')).toEqual({ stale: true });
    expect(await write(put(B), null, 't2')).toEqual({ revs: [2], bytes: 2, timeline: 't2' });
  });
});

describe('lifecycle', () => {
  it('refuses object calls per state and makes no tables unless active', async () => {
    for (const [life, refused] of [[restoring(7), 'restoring'], [{ state: 'leaving', timeline: 't1', operation: null }, 'leaving'], [null, 'gone']] as const) {
      stores = nodeStores(reads, () => now);
      row = life;
      expect(await feed()).toEqual({ refused });
      expect(await write(put(A))).toEqual({ refused });
      expect(await store().usage(INC)).toEqual({ refused });
      expect(stores.db(INC).tables()).toEqual([]);
    }
    expect(await store().status(INC)).toEqual({ state: 'gone', timeline: null, operation: null });
  });

  it('answers unavailable, never gone, when the wake read fails, is malformed or is slow, and loads again on the next call', async () => {
    reads.life = vi.fn().mockRejectedValueOnce(new Error('D1 down')).mockResolvedValueOnce(undefined).mockResolvedValueOnce({ state: 'deleted', timeline: 't1', operation: null }).mockResolvedValue(active());
    for (let attempt = 0; attempt < 3; attempt++) expect(await feed()).toEqual({ unavailable: true });
    expect(stores.db(INC).tables()).toEqual([]);
    expect(await feed()).toMatchObject({ timeline: 't1' });

    vi.useFakeTimers();
    try {
      stores = nodeStores(reads, () => now);
      let late!: (row: unknown) => void;
      reads.life = vi.fn(() => new Promise((resolve) => (late = resolve)));
      const slow = store().status(INC);
      await vi.runOnlyPendingTimersAsync();
      expect(await slow).toEqual({ unavailable: true });
      late(null);
      reads.life = vi.fn(async () => active());
      expect(await store().status(INC)).toEqual(active());
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('restore', () => {
  it('refuses restore steps for an active account or another operation, and arm unless D1 says armed', async () => {
    expect(await store().checkpoint(INC, 7)).toEqual({ wrongPhase: true });
    expect(await store().arm(INC, 7, '0')).toEqual({ wrongPhase: true });
    row = restoring(7);
    await restart();
    expect(await store().checkpoint(INC, 8)).toEqual({ wrongPhase: true });
    expect(await store().mark(INC, 8)).toEqual({ wrongPhase: true });
    expect(await store().target(INC, 8, { bookmark: '0' })).toEqual({ wrongPhase: true });

    phase = 'targeted';
    expect(await store().arm(INC, 7, '0')).toEqual({ wrongPhase: true });
    phase = 'armed';
    expect(await store().arm(INC, 7, '0')).toMatchObject({ returned: expect.any(String) });
    expect(reads.phase).toHaveBeenCalledTimes(2);
    reads.phase = vi.fn().mockRejectedValue(new Error('D1 down'));
    expect(await store().arm(INC, 7, '0')).toEqual({ unavailable: true });
  });

  it('rewinds to a time before the mark, which is then gone, and undoes to the checkpoint', async () => {
    await write(put(A, { body: 'kept' }));
    const at = (now += 1000);
    now += 1000;
    await write(put(B, { body: 'later' }));
    row = restoring(7);
    await restart();
    const { checkpoint } = (await store().checkpoint(INC, 7)) as { checkpoint: string };
    expect(await store().target(INC, 7, { at: 0 })).toEqual({ tooEarly: true });
    const { target } = (await store().target(INC, 7, { at })) as { target: string };
    expect(await store().mark(INC, 7)).toEqual({ marked: true });
    expect(await store().marked(INC, 7)).toEqual({ marked: true });
    phase = 'armed';
    await store().arm(INC, 7, target);
    await restart();
    expect(await store().marked(INC, 7)).toEqual({ marked: false });

    row = active('t2');
    await restart();
    expect(await feed({ timeline: 't2' })).toMatchObject({ cursor: 1, changes: [{ id: A, body: 'kept' }] });

    row = restoring(8);
    await restart();
    phase = 'armed';
    expect(await store().target(INC, 8, { bookmark: checkpoint })).toEqual({ target: checkpoint });
    await store().arm(INC, 8, checkpoint);
    row = active('t3');
    await restart();
    expect(await revs({ timeline: 't3' })).toEqual([1, 2]);
  });

  it('deletes a cancelled operation\'s mark once the account is active again', async () => {
    row = restoring(7);
    await restart();
    await store().mark(INC, 7);
    row = active();
    await restart();
    expect(await store().unmark(INC, 7)).toEqual({ unmarked: true });
    expect(await store().marked(INC, 7)).toEqual({ marked: false });
  });
});

describe('destroy', () => {
  it('empties a leaving store every time it is asked, and nothing else', async () => {
    await write(put(A));
    await expect(store().destroy(INC)).rejects.toThrow();
    row = { state: 'leaving', timeline: 't1', operation: null };
    await restart();
    expect(await store().destroy(INC)).toEqual({ destroyed: true });
    expect(await store().destroy(INC)).toEqual({ destroyed: true });
    expect(stores.db(INC).tables()).toEqual([]);
    await restart();
    expect(await store().destroy(INC)).toEqual({ destroyed: true });
    expect(stores.db(INC).tables()).toEqual([]);
  });
});

describe('the node double', () => {
  afterEach(() => vi.useRealTimers());

  it('refuses what workerd refuses and rolls back a transaction that throws', () => {
    const db = new NodeStoreDb(() => 0);
    for (const sql of ['BEGIN', ' savepoint s', 'PRAGMA user_version']) expect(() => db.exec(sql)).toThrow(/workerd refuses/);
    expect(() => db.transaction(() => {
      db.exec('CREATE TABLE t (x)');
      throw new Error('stop');
    })).toThrow('stop');
    expect(db.tables()).toEqual([]);
  });

  it('ends a stub at a restart', async () => {
    const stale = store();
    await expect(stale.restart(INC)).rejects.toThrow();
    await expect(stale.status(INC)).rejects.toThrow(/fresh/);
    expect(await store().status(INC)).toEqual(active());
  });
});
