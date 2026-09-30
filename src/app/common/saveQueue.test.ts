import { describe, expect, it } from 'vitest';
import type { ApiFailure } from '../../runtime/api';
import { SaveQueue } from './saveQueue';

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
});
