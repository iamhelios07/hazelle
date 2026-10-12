import { expect, it, vi } from 'vitest';
import type { ModelRef } from '../connectors/assignment';
import { fold, modelUsage, usageCalls, usageReport, type Entry, type Receipt, type UsageHeld } from '../model/chat';
import { blankCard } from '../engine/import/card';
import { memoryId, type Memory } from '../model/memory';
import type { Stored } from '../model/kinds';
import { removeChat, restoreChat } from './chat-log';
import type { ObjectStore, Write } from './store';
import { testServer } from './testing';
import { randomBytes } from '../vault/aead';
import { Usage } from './usage';

const server = testServer();
const ref = { connection: 'connection', model: 'model' };
const of = (model: ModelRef) => (held: UsageHeld[]) => modelUsage(held, model);
const receipt = (id: string, over: Partial<Receipt> = {}): Receipt => ({
  id, ...ref, source: 'source', modelName: 'model', state: 'done', cut: null, error: null, finishReason: 'stop',
  usage: null, cost: 'pending', replyId: id, firstTextMs: null, totalMs: 100, cache: null, ...over,
});
const message = (call: Receipt): Entry => ({ type: 'message', role: 'assistant', text: 'reply', at: 10, receipt: call });
const write = (parent: string, value: Entry, id = crypto.randomUUID()): Write => ({ type: 'create', kind: 'entry', id, parent, value });
async function seed(store: ObjectStore, chats: string[], entries: Write[]) {
  expect((await store.batch([...entries, ...chats.map((id): Write => ({ type: 'create', kind: 'chat', id, parent: null, value: { title: null, character: null, models: {} } }))], undefined, { unheld: true })).ok).toBe(true);
}

it('shares receipt-only projections across models, invalidating only changed heads and chat membership with canonical branch/cost semantics', async () => {
  const { store } = await server.account();
  const chats = [crypto.randomUUID(), crypto.randomUUID()];
  const call = receipt('continued', { continues: receipt('first') });
  const original = crypto.randomUUID();
  const entries = [write(chats[0]!, message(call)), write(chats[1]!, message(call), original),
    write(chats[1]!, { type: 'translation', version: original, at: 12, text: 'translation', receipt: receipt('translated', { model: 'other' }) }),
    write(chats[1]!, { type: 'call', version: original, at: 13, receipt: receipt('bot') })];
  await seed(store, chats, entries);
  const models = chats.map((chat) => fold(entries.flatMap((item, rev): Stored<'entry'>[] => item.type === 'create' && item.kind === 'entry' && item.parent === chat ? [{ ...item, kind: 'entry', value: item.value as Entry, rev: rev + 1 }] : [])));
  const usage = new Usage(store);
  const scan = vi.spyOn(store, 'scan');
  const retain = vi.spyOn(store, 'retainChat');
  const display = vi.spyOn(store.evaluation, 'display');
  const signal = new AbortController().signal;
  expect(await usage.read(of(ref), signal)).toEqual({ ok: true, data: modelUsage(models.map((messages) => ({ calls: usageCalls(messages) })), ref) });
  expect(scan).toHaveBeenCalledTimes(2);
  expect(await usage.read(of({ ...ref, model: 'other' }), signal)).toEqual({ ok: true, data: modelUsage(models.map((messages) => ({ calls: usageCalls(messages) })), { ...ref, model: 'other' }) });
  expect(scan).toHaveBeenCalledTimes(2);
  await store.batch([write(chats[1]!, { type: 'cost', replyId: 'continued', at: 15, cost: { unit: 'usd', amount: 1, source: 'reported' } })], undefined, { unheld: true });
  expect(await usage.read(of(ref), signal)).toMatchObject({ ok: true, data: { calls: 3, costUnknown: 2, costs: [{ unit: 'usd', amount: 1, estimated: false }] } });
  expect(scan).toHaveBeenCalledTimes(3);
  await removeChat(store, chats[1]!);
  expect(await usage.read(of(ref), signal)).toMatchObject({ ok: true, data: { calls: 2, costUnknown: 2, costs: [] } });
  expect(scan).toHaveBeenCalledTimes(3);
  await restoreChat(store, chats[1]!);
  expect(await usage.read(of(ref), signal)).toMatchObject({ ok: true, data: { calls: 3, costs: [{ amount: 1 }] } });
  expect(scan).toHaveBeenCalledTimes(4);
  expect(retain).not.toHaveBeenCalled();
  expect(display).not.toHaveBeenCalled();
  expect(chats.every((id) => store.scopeState(id) === 'unloaded')).toBe(true);
  usage.close();
});

it('counts the receipts a chat’s memory and a kept character’s 삽화 profile hold, and reads a memory changed alone again', async () => {
  const { store } = await server.account();
  const chat = crypto.randomUUID();
  await seed(store, [chat], [write(chat, message(receipt('reply')))]);
  const written = (id: string, call: string, at: number) => ({ id, sources: [], print: '', when: null, where: null, who: [], what: '', lines: [], outcome: '', receipt: receipt(call), at });
  const memory: Memory = { records: [{ ...written('r1', 'summary', 11), state: [], opens: [], closes: [] }], chapters: [], state: [], threads: [] };
  expect((await store.batch([{ type: 'create', kind: 'memory', id: memoryId(chat), parent: chat, value: memory }], undefined, { unheld: true })).ok).toBe(true);
  const character = await store.create('character', { card: blankCard('루나'), folder: null, loreFolders: [] });
  if (!character.ok) throw new Error(character.error);
  expect((await store.create('likeness', { portraits: [], at: 12, receipt: receipt('profile') }, { parent: character.data.id })).ok).toBe(true);
  const usage = new Usage(store);
  const report = (held: UsageHeld[]) => usageReport(held, 'all', Date.now()).characters.map(({ key, usage }) => [key, usage.calls]);
  expect(await usage.read(report, new AbortController().signal)).toEqual({ ok: true, data: [[null, 2], [character.data.id, 1]] });
  const lease = store.retainChat(chat);
  await lease.ready;
  expect((await store.update('memory', memoryId(chat), (held) => ({ ...held, chapters: [{ ...written('c1', 'chapter', 13), records: [{ id: 'r1', at: 11 }] }] }))).ok).toBe(true);
  lease.release();
  expect(await usage.read(report, new AbortController().signal)).toEqual({ ok: true, data: [[null, 3], [character.data.id, 1]] });
  usage.close();
});

it('does not mark receipts current when an entry lands during their scan', async () => {
  const { store } = await server.account();
  const chat = crypto.randomUUID();
  await seed(store, [chat], [write(chat, message(receipt('call')))]);
  const scan = store.scan.bind(store);
  let changed = false;
  const reads = vi.spyOn(store, 'scan').mockImplementation(async (...args) => {
    const result = await scan(...args);
    if (!changed) {
      changed = true;
      await store.batch([write(chat, { type: 'cost', replyId: 'call', at: 20, cost: { unit: 'usd', amount: 2, source: 'reported' } })], undefined, { unheld: true });
    }
    return result;
  });
  const usage = new Usage(store);
  expect(await usage.read(of(ref), new AbortController().signal)).toMatchObject({ ok: true, data: { calls: 1, costs: [{ amount: 2 }], costUnknown: 0 } });
  expect(reads).toHaveBeenCalledTimes(2);
  usage.close();
});

it('aborts a blocked parent request and rebuilds it on a later read rather than caching an empty success', async () => {
  const { store } = await server.account();
  const chat = crypto.randomUUID();
  await seed(store, [chat], [write(chat, message(receipt('call')))]);
  const fetch = globalThis.fetch;
  let blocked = false;
  const requested = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    if (String(input).includes('&parent=')) {
      blocked = true;
      return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), { once: true }));
    }
    return fetch(input, init);
  });
  const usage = new Usage(store);
  const abort = new AbortController();
  const reading = usage.read(of(ref), abort.signal);
  await vi.waitFor(() => expect(blocked).toBe(true));
  abort.abort();
  expect(await reading).toEqual({ ok: false, error: 'stopped' });
  requested.mockRestore();
  expect(await usage.read(of(ref), new AbortController().signal)).toMatchObject({ ok: true, data: { calls: 1 } });
  usage.close();
});

it('reports an unreadable entry or a stored body that does not open instead of caching a partial total', async () => {
  const { store, open } = await server.account();
  const chat = crypto.randomUUID();
  const foreign = crypto.randomUUID();
  await seed(store, [chat, foreign], [write(chat, message(receipt('call')))]);
  // A device with another vault key writes an entry this one cannot decrypt.
  const other = await open(randomBytes(32));
  expect((await other.batch([write(foreign, message(receipt('other')))], undefined, { unheld: true })).ok).toBe(true);
  const usage = new Usage(store);
  const signal = new AbortController().signal;
  expect(await usage.read(of(ref), signal)).toEqual({ ok: false, error: 'unreadable' });
  expect((await store.remove(foreign)).ok).toBe(true);
  expect(await usage.read(of(ref), signal)).toMatchObject({ ok: true, data: { calls: 1 } });
  const broken = crypto.randomUUID();
  const real = fetch;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (url !== '/api/objects/batch') return real(url, init);
    const sent = JSON.parse(init!.body as string) as { writes: { id: string; body: string | null }[] };
    return real(url, { ...init, body: JSON.stringify({ ...sent, writes: sent.writes.map((write) => (write.id === broken ? { ...write, body: 'not base64!' } : write)) }) });
  });
  await seed(store, [], [write(chat, message(receipt('late')), broken)]);
  vi.stubGlobal('fetch', real);
  expect(await usage.read(of(ref), signal)).toEqual({ ok: false, error: 'usage-unavailable' });
  usage.close();
});
