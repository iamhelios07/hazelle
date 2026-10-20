import { describe, expect, it } from 'vitest';
import type { ApiFailure } from '../../runtime/api';
import { SaveQueue } from '../common/saveQueue';
import { editing } from './editing';

type Answer = { ok: true } | ApiFailure;

function queue() {
  const writes: { patch: object; answer: (answer: Answer) => void }[] = [];
  const saves = new SaveQueue<{ text: string }>(
    (patch) => new Promise((answer) => writes.push({ patch, answer })),
    () => {},
  );
  return { saves, writes };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('editing', () => {
  it('answers a flush once every queue has written what was typed', async () => {
    const owner = queue();
    const note = queue();
    owner.saves.change({ text: 'name' });
    note.saves.change({ text: 'note' });
    let flushed: boolean | null = null;
    void editing(owner.saves, [note.saves]).flush().then((done) => (flushed = done));
    await settle();
    owner.writes[0]!.answer({ ok: true });
    await settle();
    expect(flushed).toBeNull();
    note.writes[0]!.answer({ ok: true });
    await settle();
    expect(flushed).toBe(true);
  });

  it('does not remove while another queue could not write', async () => {
    const owner = queue();
    const note = queue();
    note.saves.change({ text: 'note' });
    let ran = false;
    const removed = editing(owner.saves, [note.saves]).remove(async () => {
      ran = true;
      return { ok: true };
    });
    await settle();
    note.writes[0]!.answer({ ok: false, error: 'offline' });
    expect(await removed).toBeNull();
    expect(ran).toBe(false);
  });
});
