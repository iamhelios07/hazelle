import { describe, expect, it, vi } from 'vitest';
import { EvaluationStuck } from './evaluation';
import type { ObjectStore, Write } from './store';
import { saveSummaries, summaryId } from './summary';
import { testServer } from './testing';

const server = testServer();

const message = (parent: string, text: string): Write => ({ type: 'create', kind: 'entry', id: crypto.randomUUID(), parent, value: { type: 'message', role: 'user', at: 0, text, receipt: null } });
const root = (id: string, persona?: string): Write => ({ type: 'create', kind: 'chat', id, parent: null, value: { title: null, character: null, models: {}, ...(persona && { persona }) } });

// As the worker does on a stall: the chat is judged before the job fails.
function stickOnce(store: ObjectStore, chat: string) {
  const display = store.evaluation.display.bind(store.evaluation);
  return vi.spyOn(store.evaluation, 'display').mockImplementation(async (lane, ...rest) => {
    if (lane.chat !== chat || store.projections.verdict(chat)) return display(lane, ...rest);
    store.projections.judge(chat);
    throw new EvaluationStuck('stuck');
  });
}

describe('a chat whose bot does not end', () => {
  it('is summarized from its display without the regex, carries the verdict to another device, and backfill goes past it', async () => {
    const { store, open } = await server.account();
    const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
    expect((await store.batch([root(a), root(b), message(a, 'one'), message(b, 'two')], undefined, { unheld: true })).ok).toBe(true);
    const displayed = stickOnce(store, a);
    expect(await saveSummaries(store, [a, b])).toBeNull();
    expect(displayed.mock.calls.filter(([lane]) => lane.chat === a)).toHaveLength(2);
    expect(store.get('summary', summaryId(a))!.value).toMatchObject({ preview: 'one', stuck: { dependencies: expect.any(Array) } });
    expect(store.get('summary', summaryId(b))!.value).toMatchObject({ preview: 'two' });
    expect(store.get('summary', summaryId(b))!.value.stuck).toBeUndefined();
    const phone = await open();
    await phone.pull();
    expect(phone.projections.verdict(a)).not.toBeNull();
    expect(phone.projections.verdict(b)).toBeNull();
  });

  it('fails as bot-stuck, once, when even its display without the regex does not end', async () => {
    const { store } = await server.account();
    const a = crypto.randomUUID();
    expect((await store.batch([root(a), message(a, 'one')], undefined, { unheld: true })).ok).toBe(true);
    const lease = store.retainChat(a);
    expect(await lease.ready).toBeNull();
    const displayed = vi.spyOn(store.evaluation, 'display').mockRejectedValue(new EvaluationStuck('stuck'));
    store.projections.judge(a);
    await vi.waitFor(() => expect(store.scopeError(a)).toEqual({ ok: false, error: 'bot-stuck' }));
    expect(displayed).toHaveBeenCalledTimes(1);
    lease.release();
  });

  it('is shown with the regex again once what it was judged on changes, or 다시 시도 clears it, and its summary drops the verdict', async () => {
    const { store } = await server.account();
    const [a, persona] = [crypto.randomUUID(), crypto.randomUUID()];
    expect((await store.create('persona', { name: 'Mina', description: '', picture: null }, { id: persona })).ok).toBe(true);
    expect((await store.batch([root(a, persona), message(a, 'one')], undefined, { unheld: true })).ok).toBe(true);
    const lease = store.retainChat(a);
    expect(await lease.ready).toBeNull();
    expect(store.get('summary', summaryId(a))!.value.stuck).toBeUndefined();
    expect(store.projections.verdict(a)).toBeNull();
    store.projections.judge(a);
    await vi.waitFor(() => expect(store.get('summary', summaryId(a))!.value.stuck).toBeDefined());
    await store.update('persona', persona, (value) => ({ ...value, name: 'Luna' }));
    expect(store.projections.verdict(a)).toBeNull();
    store.projections.judge(a);
    expect(store.projections.verdict(a)).not.toBeNull();
    store.projections.clear(a);
    expect(store.projections.verdict(a)).toBeNull();
    await vi.waitFor(() => expect(store.get('summary', summaryId(a))!.value.stuck).toBeUndefined());
    expect(store.projections.get(a)!.summary.stuck).toBeUndefined();
    lease.release();
  });
});
