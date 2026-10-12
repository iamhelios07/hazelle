import { foldTree, usageCall, usageCalls } from '../model/chat';
import type { UsageCall, UsageHeld } from '../model/usage';
import { isValue, type Stored } from '../model/kinds';
import { live } from '../model/library';
import type { ApiResult } from './api';
import type { ObjectStore, Pin } from './store';

// Derived receipts live only as long as the unlocked session, never in a second persisted account/cache shape.
export class Usage {
  private readonly chats = new Map<string, { stamp: string; calls: UsageCall[] }>();
  private readonly closing = new AbortController();
  private pin: Pin | null = null;
  private running: Promise<unknown> | null = null;

  constructor(private readonly store: ObjectStore) {}

  close() {
    this.closing.abort();
    this.chats.clear();
  }

  // count is given the calls of each remaining chat and each 삽화 profile, once all of them are read. progress hears how
  // many chats of how many are read so far.
  async read<T>(count: (held: UsageHeld[]) => T, signal: AbortSignal, progress?: (read: number, of: number) => void): Promise<ApiResult<T>> {
    const stop = AbortSignal.any([signal, this.closing.signal]);
    while (this.running) {
      await this.running;
      if (stop.aborted) return { ok: false, error: 'stopped' };
    }
    const running = this.aggregate(count, stop, progress).catch((): ApiResult<T> => ({ ok: false, error: stop.aborted ? 'stopped' : 'usage-unavailable' }));
    this.running = running;
    try { return await running; }
    finally { this.running = null; }
  }

  private async aggregate<T>(count: (held: UsageHeld[]) => T, signal: AbortSignal, progress?: (read: number, of: number) => void): Promise<ApiResult<T>> {
    if (signal.aborted) return { ok: false, error: 'stopped' };
    const failed = await this.store.pull({ signal });
    if (failed) return failed;
    const pinned = await this.store.pin(signal);
    if (!pinned.ok) return pinned;
    const pin = pinned.data;
    if (this.pin?.timeline !== pin.timeline || this.pin.epoch !== pin.epoch) this.chats.clear();
    this.pin = pin;
    for (;;) {
      const chats = this.store.list('chat').filter(live);
      const ids = new Set(chats.map(({ id }) => id));
      for (const id of this.chats.keys()) if (!ids.has(id)) this.chats.delete(id);
      for (const [index, { id }] of chats.entries()) {
        if (signal.aborted) return { ok: false, error: 'stopped' };
        progress?.(index, chats.length);
        const stamp = this.stamp(id);
        if (this.chats.get(id)?.stamp === stamp) continue;
        const entries: Stored<'entry'>[] = [];
        const calls: UsageCall[] = [];
        let unreadable = false;
        const failure = await this.store.scan({ parent: id }, (row, value) => {
          if (row.kind === 'entry') {
            if (isValue('entry', value)) entries.push({ ...row, kind: 'entry', value });
            else unreadable = true;
          } else if (row.kind === 'illustration') {
            if (!isValue('illustration', value)) unreadable = true;
            else if (value.receipt) calls.push(usageCall(value.receipt, value.at));
          } else if (row.kind === 'memory') {
            if (!isValue('memory', value)) unreadable = true;
            else for (const { receipt, at } of [...value.records, ...value.chapters]) if (receipt) calls.push(usageCall(receipt, at));
          }
        }, pin, signal);
        if (failure) return failure;
        if (unreadable) return { ok: false, error: 'unreadable' };
        if (signal.aborted) return { ok: false, error: 'stopped' };
        // Never stamp a scan with a head acquired after it: an edit during that scan must be read again.
        if (stamp !== this.stamp(id)) continue;
        this.chats.set(id, { stamp, calls: [...usageCalls(foldTree(entries).map(({ message }) => message)), ...calls] });
      }
      const current = this.store.list('chat').filter(live);
      if (current.length !== chats.length || current.some(({ id }) => !ids.has(id) || this.chats.get(id)?.stamp !== this.stamp(id))) continue;
      const held = current.map(({ id, value }): UsageHeld => ({ chat: id, character: value.character, branch: value.origin !== undefined, calls: this.chats.get(id)!.calls }));
      // A profile describes a character, a module or a persona, and counts while that one is kept; only a character's
      // counts under one.
      const profiles = this.store.list('likeness').flatMap(({ parent, value }): UsageHeld[] => {
        if (!value.receipt || !parent) return [];
        const character = live(this.store.get('character', parent));
        if (!character && !live(this.store.get('module', parent)) && !live(this.store.get('persona', parent))) return [];
        return [{ character: character ? parent : null, calls: [usageCall(value.receipt, value.at)] }];
      });
      return { ok: true, data: count([...held, ...profiles]) };
    }
  }

  // What a chat's receipts were read at: its entries, and its 삽화 and memory, whose changes move no entry head.
  private stamp(chat: string) {
    return [this.store.entryHead(chat), this.store.revision({ kind: 'illustration', parent: chat }), this.store.revision({ kind: 'memory', parent: chat })].join(':');
  }
}
