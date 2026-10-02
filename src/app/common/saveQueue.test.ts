import { describe, expect, it } from 'vitest';
import type { ApiFailure } from '../../runtime/api';
import { SaveQueue, Saves } from './saveQueue';

type Note = { title: string; body: string };
type Answer = { ok: true } | ApiFailure;

// Each write waits until the test answers it.
function queue() {
  const writes: { patch: Partial<Note>; answer: (answer: Answer) => void }[] = [];
  const saves = new SaveQueue<Note>(
    (patch) => new Promise((answer) => writes.push({ patch, answer })),
    () => {},
  );
  return { saves, writes };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SaveQueue', () => {
  it('tries a failed patch again on the next flush, under what was typed since', async () => {
    const { saves, writes } = queue();
    saves.change({ title: 'a', body: 'x' });
    const first = saves.flush();
    await settle();
    saves.change({ title: 'b' });
    writes[0]!.answer({ ok: false, error: 'offline' });
    expect(await first).toBe(false);
    expect(saves.status).toBe('saving');

    const second = saves.flush();
    await settle();
    expect(writes[1]!.patch).toEqual({ title: 'b', body: 'x' });
    writes[1]!.answer({ ok: true });
    expect(await second).toBe(true);
    expect(saves.status).toBe('saved');
  });

  it('starts the next save only once the one in flight is answered', async () => {
    const { saves, writes } = queue();
    saves.change({ title: 'a' });
    void saves.flush();
    await settle();
    saves.change({ body: 'x' });
    const second = saves.flush();
    await settle();
    expect(writes).toHaveLength(1);

    writes[0]!.answer({ ok: true });
    await settle();
    expect(writes.map((write) => write.patch)).toEqual([{ title: 'a' }, { body: 'x' }]);
    writes[1]!.answer({ ok: true });
    expect(await second).toBe(true);
  });

  it('counts a save in flight as unsaved until it is answered', async () => {
    const { saves, writes } = queue();
    saves.change({ title: 'a' });
    const flushed = saves.flush();
    await settle();
    expect(saves.busy).toBe(true);
    expect(saves.unsaved).toEqual({ title: 'a' });
    writes[0]!.answer({ ok: true });
    await flushed;
    expect(saves.busy).toBe(false);
  });

  it('runs a removal once what was changed is stored, and drops what is typed while it runs', async () => {
    const { saves, writes } = queue();
    saves.change({ title: 'a' });
    let answer!: (result: { ok: boolean }) => void;
    const removed = saves.remove(() => new Promise<{ ok: boolean }>((resolve) => (answer = resolve)));
    await settle();
    expect(writes[0]!.patch).toEqual({ title: 'a' });
    writes[0]!.answer({ ok: true });
    await settle();

    saves.change({ title: 'b' });
    answer({ ok: true });
    expect(await removed).toEqual({ ok: true });
    saves.change({ title: 'c' });
    expect(await saves.flush()).toBe(true);
    expect(writes).toHaveLength(1);
    expect(saves.busy).toBe(false);
  });

  it('does not run a removal when a change could not be stored', async () => {
    const { saves, writes } = queue();
    saves.change({ title: 'a' });
    let ran = false;
    const removed = saves.remove(async () => ({ ok: (ran = true) }));
    await settle();
    writes[0]!.answer({ ok: false, error: 'too-large' });
    expect(await removed).toBeNull();
    expect(ran).toBe(false);
    expect(saves.unsaved).toEqual({ title: 'a' });
  });
});

// The page's beforeunload listeners, which stand for the browser asking before the tab goes.
function page() {
  const asking = new Set<unknown>();
  const target = { addEventListener: (_: string, listener: unknown) => void asking.add(listener), removeEventListener: (_: string, listener: unknown) => void asking.delete(listener) };
  return { target: target as unknown as Window, asks: () => asking.size > 0 };
}

describe('Saves', () => {
  it('gives a screen opened again the queue the one before it left, so its save lands after the earlier one', async () => {
    const { target, asks } = page();
    const saves = new Saves(target);
    const writes: { patch: Partial<Note>; answer: (answer: Answer) => void }[] = [];
    const write = (patch: Partial<Note>) => new Promise<Answer>((answer) => writes.push({ patch, answer }));

    const leave = saves.watch('note', () => {});
    saves.queue<Note>('note', write, () => {}).change({ title: 'a' });
    leave();
    void saves.flush('note');
    await settle();

    const leaveAgain = saves.watch('note', () => {});
    expect(saves.view<Note>('note').unsaved).toEqual({ title: 'a' });
    void saves.queue<Note>('note', write, () => {}).save({ title: 'b' });
    await settle();
    expect(writes).toHaveLength(1);
    writes[0]!.answer({ ok: true });
    await settle();
    expect(writes[1]!.patch).toEqual({ title: 'b' });

    leaveAgain();
    expect(asks()).toBe(true);
    writes[1]!.answer({ ok: true });
    await settle();
    expect(asks()).toBe(false);
  });

  it('tells a save that failed after its screen was left once, and drops it', async () => {
    const { target, asks } = page();
    const saves = new Saves(target);
    const told: ApiFailure[] = [];
    let answer!: (answer: Answer) => void;
    const leave = saves.watch('note', () => {});
    saves.queue<Note>('note', () => new Promise<Answer>((resolve) => (answer = resolve)), (failure) => told.push(failure)).change({ title: 'a' });
    leave();
    void saves.flush('note');
    await settle();
    answer({ ok: false, error: 'gone' });
    await settle();
    expect(told).toEqual([{ ok: false, error: 'gone' }]);
    expect(saves.view<Note>('note').unsaved).toEqual({});
    expect(asks()).toBe(false);
  });

  it('drops what waits when the session closes', async () => {
    const { target, asks } = page();
    const saves = new Saves(target);
    const written: Partial<Note>[] = [];
    saves.watch('note', () => {});
    const note = saves.queue<Note>('note', async (patch) => (written.push(patch), { ok: true }), () => {});
    note.change({ title: 'a' });
    saves.close();
    expect(asks()).toBe(false);
    expect(await note.flush()).toBe(true);
    expect(written).toEqual([]);
  });

  it('writes what waits its pause at once for leaving, and stops waiting at the bound for a save that is not answered', async () => {
    const saves = new Saves(page().target);
    const written: Partial<Note>[] = [];
    saves.queue<Note>('note', async (patch) => (written.push(patch), { ok: true }), () => {}).change({ title: 'a' });
    expect(await saves.settled(1000)).toBe(true);
    expect(written).toEqual([{ title: 'a' }]);

    saves.queue<Note>('other', () => new Promise<Answer>(() => {}), () => {}).change({ body: 'x' });
    expect(await saves.settled(10)).toBe(false);
  });
});
