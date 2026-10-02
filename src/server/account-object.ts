import { DurableObject } from 'cloudflare:workers';
import { d1Reads, StoreRules, type FeedQuery, type StoreDb, type Write } from './account-store';

// The text workerd throws from getBookmarkForTime for a time before the store's database existed (measured
// 2026-10-02). Any other failure is not this answer and propagates.
const TOO_EARLY = /before this database existed/;

// One account's store, named by its incarnation (getByName, no location hint). Every method takes the incarnation
// first: ctx.id.name is not relied on.
export class AccountStore extends DurableObject<Env> {
  private readonly rules: StoreRules;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.rules = new StoreRules(workerdDb(ctx.storage), d1Reads(env.DB), (work) => ctx.blockConcurrencyWhile(work));
  }

  status(incarnation: string) {
    return this.rules.status(incarnation);
  }

  feed(incarnation: string, query: FeedQuery) {
    return this.rules.feed(incarnation, query);
  }

  batch(incarnation: string, timeline: string, writes: Write[], cap: number | null) {
    return this.rules.batch(incarnation, timeline, writes, cap);
  }

  usage(incarnation: string) {
    return this.rules.usage(incarnation);
  }

  checkpoint(incarnation: string, operation: number) {
    return this.rules.checkpoint(incarnation, operation);
  }

  target(incarnation: string, operation: number, from: { at: number } | { bookmark: string }) {
    return this.rules.target(incarnation, operation, from);
  }

  mark(incarnation: string, operation: number) {
    return this.rules.mark(incarnation, operation);
  }

  unmark(incarnation: string, operation: number) {
    return this.rules.unmark(incarnation, operation);
  }

  marked(incarnation: string, operation: number) {
    return this.rules.marked(incarnation, operation);
  }

  arm(incarnation: string, operation: number, target: string) {
    return this.rules.arm(incarnation, operation, target);
  }

  destroy(incarnation: string) {
    return this.rules.destroy(incarnation);
  }

  // The next call meets a fresh instance, which loads the lifecycle from D1 again and applies a pending restore. The
  // caller never reads this call's failure as a result; it verifies with status() on a fresh stub.
  restart(incarnation: string): never {
    this.ctx.abort(`restart ${incarnation}`);
    throw new Error('ctx.abort() returned.');
  }
}

function workerdDb(storage: DurableObjectStorage): StoreDb {
  return {
    exec: <T>(sql: string, ...binds: (string | number | null)[]) => storage.sql.exec(sql, ...binds).toArray() as T[],
    transaction: (fn) => storage.transactionSync(fn),
    wipe: () => storage.deleteAll(),
    kv: storage.kv,
    size: () => storage.sql.databaseSize,
    bookmarks: {
      current: () => storage.getCurrentBookmark(),
      forTime: (at) =>
        storage.getBookmarkForTime(at).catch((error: unknown) => {
          if (error instanceof Error && TOO_EARLY.test(error.message)) return null;
          throw error;
        }),
      restoreOnNextSession: (bookmark) => storage.onNextSessionRestoreBookmark(bookmark),
    },
  };
}
