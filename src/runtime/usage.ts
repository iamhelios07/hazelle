import type { ModelRef } from '../connectors/assignment';
import { fold, usageCalls, UsageCounter, type ModelUsage, type UsageCall } from '../model/chat';
import { isValue, type Stored } from '../model/kinds';
import { live } from '../model/library';
import type { ApiResult } from './api';
import type { ObjectStore, Pin } from './store';

// Derived receipts live only as long as the unlocked session, never in a second persisted account/cache shape.
export class Usage {
  private readonly chats = new Map<string, { head: number; calls: UsageCall[] }>();
  private readonly closing = new AbortController();
  private pin: Pin | null = null;
  private running: Promise<ApiResult<ModelUsage>> | null = null;

  constructor(private readonly store: ObjectStore) {}

  close() {
    this.closing.abort();
    this.chats.clear();
  }

  async read(ref: ModelRef, signal: AbortSignal): Promise<ApiResult<ModelUsage>> {
    const stop = AbortSignal.any([signal, this.closing.signal]);
    while (this.running) {
      await this.running;
      if (stop.aborted) return { ok: false, error: 'stopped' };
    }
    const running = this.aggregate(ref, stop).catch((): ApiResult<ModelUsage> => ({ ok: false, error: stop.aborted ? 'stopped' : 'usage-unavailable' }));
    this.running = running;
    try { return await running; }
    finally { this.running = null; }
  }

  private async aggregate(ref: ModelRef, signal: AbortSignal): Promise<ApiResult<ModelUsage>> {
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
      for (const { id } of chats) {
        if (signal.aborted) return { ok: false, error: 'stopped' };
        const head = this.store.entryHead(id);
        if (this.chats.get(id)?.head === head) continue;
        const entries: Stored<'entry'>[] = [];
        let unreadable = false;
        const failure = await this.store.scan({ parent: id }, (row, value) => {
          if (row.kind !== 'entry') return;
          if (isValue('entry', value)) entries.push({ ...row, kind: 'entry', value });
          else unreadable = true;
        }, pin, signal);
        if (failure) return failure;
        if (unreadable) return { ok: false, error: 'unreadable' };
        if (signal.aborted) return { ok: false, error: 'stopped' };
        // Never stamp a scan with a head acquired after it: an edit during that scan must be read again.
        if (head !== this.store.entryHead(id)) continue;
        this.chats.set(id, { head, calls: [...usageCalls(fold(entries))] });
      }
      const current = this.store.list('chat').filter(live);
      if (current.length !== chats.length || current.some(({ id }) => !ids.has(id) || this.chats.get(id)?.head !== this.store.entryHead(id))) continue;
      const counter = new UsageCounter(ref);
      for (const { id } of current) counter.add(this.chats.get(id)!.calls);
      return { ok: true, data: counter.value };
    }
  }
}
