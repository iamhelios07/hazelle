import { ChangeSignal } from '../change-signal';
import { foldTree, usageCall, usageCalls, type Receipt } from '../model/chat';
import type { Cost } from '../connectors/types';
import { isValue, type Stored } from '../model/kinds';
import { SETTINGS_ID } from '../model/settings';
import { counted, type Counted, type Ledger, type UsageCall } from '../model/usage';
import type { ApiResult } from './api';
import type { Write } from './object-writes';
import type { ObjectStore, Pin } from './store';

// A call's row: the call's id with UUID version 8, since the call's own id is its stream marker's, and no id the app
// makes (crypto.randomUUID, version 4) is ever one. The same call always gets the same row, so writing it again lands
// as written (server once).
export const ledgerId = (call: string) => `${call.slice(0, 14)}8${call.slice(15)}`;

export type CallPlace = { chat: string | null; character: string | null };

export const callRow = ({ at, call }: UsageCall, { chat, character }: CallPlace): Write =>
  ({ type: 'create', kind: 'ledger', id: ledgerId(call.id), parent: SETTINGS_ID, value: { type: 'call', at, call, chat, character } });

export const receiptRow = (receipt: Receipt, at: number, place: CallPlace) => callRow(usageCall(receipt, at), place);

export const chatPlace = (store: ObjectStore, chat: string): CallPlace => ({ chat, character: store.get('chat', chat)?.value.character ?? null });

export const costRow = (call: string, cost: Cost | null): Write =>
  ({ type: 'create', kind: 'ledger', id: crypto.randomUUID(), parent: SETTINGS_ID, value: { type: 'cost', call, cost, at: Date.now() } });

// For a call no other write saves.
export const keepRow = (store: ObjectStore, receipt: Receipt, at: number, place: CallPlace) => store.batch([receiptRow(receipt, at, place)]);

const FILL_STEP = 100;

// This page's fill: how far it has gone while it runs, failed when it stopped short (the account keeps where).
export type Filling = { read: number; of: number } | 'failed' | null;

// The ledger read for the usage screens. Its rows stay for the session and are cached on the device by the store's
// walk, so a read after the first asks only for the rows written since.
export class Usage {
  private readonly rows = new Map<string, Ledger>();
  private cursor = 0;
  private pin: Pin | null = null;
  private readonly closing = new AbortController();
  private running: Promise<unknown> | null = null;
  private filled: Filling = null;
  private readonly changes = new ChangeSignal();

  constructor(private readonly store: ObjectStore) {}

  readonly subscribe = this.changes.subscribe;

  readonly filling = () => this.filled;

  close() {
    this.closing.abort();
    this.rows.clear();
    this.changes.clear();
  }

  async read(signal: AbortSignal): Promise<ApiResult<Counted[]>> {
    const stop = AbortSignal.any([signal, this.closing.signal]);
    while (this.running) {
      await this.running;
      if (stop.aborted) return { ok: false, error: 'stopped' };
    }
    // A restore moved the account to another timeline as the walk began: the next walk reads that one whole.
    const walked = async () => {
      const first = await this.walk(stop);
      return !first.ok && first.error === 'timeline-changed' ? this.walk(stop) : first;
    };
    const running = walked().catch((): ApiResult<Counted[]> => ({ ok: false, error: stop.aborted ? 'stopped' : 'usage-unavailable' }));
    this.running = running;
    try { return await running; }
    finally { this.running = null; }
  }

  private async walk(signal: AbortSignal): Promise<ApiResult<Counted[]>> {
    const pinned = await this.store.pin(signal);
    if (!pinned.ok) return pinned;
    const pin = pinned.data;
    if (this.pin?.timeline !== pin.timeline || this.pin.epoch !== pin.epoch) {
      this.rows.clear();
      this.cursor = 0;
    }
    this.pin = pin;
    let unreadable = false;
    const walked = await this.store.walk(SETTINGS_ID, 'ledger', (row, value) => {
      if (isValue('ledger', value)) this.rows.set(row.id, value);
      else unreadable = true;
    }, this.cursor, pin, signal);
    if (!walked.ok) return walked;
    if (unreadable) return { ok: false, error: 'unreadable' };
    this.cursor = walked.data;
    return { ok: true, data: counted(this.rows.values()) };
  }

  // Writes the rows of the calls made before the ledger, once per account: every chat's receipts, its 삽화 and memory,
  // in 휴지통 too, and each 삽화 profile's. The originals go before their branches, which copy their calls, so a call
  // counts under the chat that made it; settings keeps how far the fill went, and one cut short goes on from there.
  async fill(signal: AbortSignal = this.closing.signal): Promise<void> {
    const stop = AbortSignal.any([signal, this.closing.signal]);
    const settings = this.store.get('settings', SETTINGS_ID)?.value;
    if (!settings || settings.ledger === 'filled' || (this.filled && this.filled !== 'failed')) return;
    this.filled = { read: 0, of: 0 };
    this.changes.notify();
    const ended = await this.filledAll(settings.ledger?.after ?? '', stop);
    this.filled = ended || stop.aborted ? null : 'failed';
    this.changes.notify();
  }

  private async filledAll(after: string, signal: AbortSignal): Promise<boolean> {
    const pinned = await this.store.pin(signal);
    if (!pinned.ok) return false;
    const order = ({ id, value }: Stored<'chat'>) => `${value.origin ? 1 : 0}:${id}`;
    const chats = this.store.list('chat').filter((chat) => order(chat) > after).sort((a, b) => (order(a) < order(b) ? -1 : 1));
    const mark = async (ledger: 'filled' | { after: string }) => (await this.store.upsert('settings', (current) => ({ ...current!, ledger }))).ok;
    for (const [index, chat] of chats.entries()) {
      this.filled = { read: index, of: chats.length };
      this.changes.notify();
      const rows = await this.chatRows(chat, pinned.data, signal);
      if (!rows) return false;
      if (rows.length && !(await this.store.batch(rows, undefined, { signal })).ok) return false;
      if ((index + 1) % FILL_STEP === 0 && !(await mark({ after: order(chat) }))) return false;
    }
    const profiles = this.store.list('likeness').flatMap(({ parent, value }) =>
      (value.receipt ? [receiptRow(value.receipt, value.at, { chat: null, character: parent && this.store.get('character', parent) ? parent : null })] : []));
    if (profiles.length && !(await this.store.batch(profiles, undefined, { signal })).ok) return false;
    return mark('filled');
  }

  // null: the chat could not be read, and the fill stops there.
  private async chatRows({ id, value }: Stored<'chat'>, pin: Pin, signal: AbortSignal): Promise<Write[] | null> {
    const entries: Stored<'entry'>[] = [];
    const calls: UsageCall[] = [];
    let unreadable = false;
    const failure = await this.store.scan({ parent: id }, (row, held) => {
      if (row.kind === 'entry') {
        if (isValue('entry', held)) entries.push({ ...row, kind: 'entry', value: held });
        else unreadable = true;
      } else if (row.kind === 'illustration') {
        if (!isValue('illustration', held)) unreadable = true;
        else if (held.receipt) calls.push(usageCall(held.receipt, held.at));
      } else if (row.kind === 'memory') {
        if (!isValue('memory', held)) unreadable = true;
        else for (const { receipt, at } of [...held.records, ...held.chapters]) if (receipt) calls.push(usageCall(receipt, at));
      }
    }, pin, signal);
    if (failure || unreadable) return null;
    const place = { chat: id, character: value.character };
    // An edit keeps the receipt it changes, and a batch takes an id once.
    const once = new Map<string, Write>();
    for (const one of [...usageCalls(foldTree(entries).map(({ message }) => message)), ...calls]) if (!once.has(one.call.id)) once.set(one.call.id, callRow(one, place));
    return [...once.values()];
  }
}
