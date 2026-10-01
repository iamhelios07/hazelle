import { describe, expect, it } from 'vitest';
import { fingerprint, memoryBudget, nextSpan, parseRecords, windowStart } from './memory';

const span = ['Luna: "I will  wait\nfor you until spring."', 'jin leaves the lighthouse.', 'Spring comes. Luna lights the lamp.'];
const record = (to: number, lines: { speaker: string; text: string }[] = []) => ({
  to,
  when: null,
  where: 'the lighthouse',
  who: ['Luna', 'jin'],
  what: 'Luna promises to wait.',
  lines,
  outcome: '',
  state: [{ about: 'Luna', field: 'waiting for', value: 'jin' }],
  opens: ['Luna waits for jin until spring.'],
  closes: [],
});
const answer = (records: unknown[]) => JSON.stringify({ records });

describe('parseRecords', () => {
  it('reads records that cover the span in order, with key lines found word for word apart from spacing, inside a fenced answer', () => {
    const parsed = parseRecords('```json\n' + answer([record(2, [{ speaker: 'Luna', text: 'I will wait for you until spring.' }]), record(3)]) + '\n```', span);
    expect(parsed).toMatchObject({ ok: true, records: [{ to: 2, lines: [{ speaker: 'Luna' }] }, { to: 3 }] });
  });

  it('refuses an answer that is not JSON, one with a field missing or a gap left, and a key line the messages never said', () => {
    expect(parseRecords('Here is the summary.', span)).toEqual({ ok: false, reason: 'unreadable' });
    expect(parseRecords(answer([{ ...record(3), opens: undefined }]), span)).toEqual({ ok: false, reason: 'fields' });
    expect(parseRecords(answer([record(2)]), span)).toEqual({ ok: false, reason: 'fields' });
    expect(parseRecords(answer([record(3, [{ speaker: 'Luna', text: 'I will always wait for you.' }])]), span)).toEqual({ ok: false, reason: 'lines' });
    expect(parseRecords(answer([record(1), record(3, [{ speaker: 'Luna', text: 'I will wait for you until spring.' }])]), span)).toEqual({ ok: false, reason: 'lines' });
  });
});

describe('fingerprint', () => {
  it('is the same for the same messages and differs for one changed letter or role', () => {
    const messages = [{ role: 'user', text: 'Hello.' }, { role: 'assistant', text: 'Hi.' }];
    expect(fingerprint(messages)).toBe(fingerprint(structuredClone(messages)));
    expect(fingerprint(messages)).not.toBe(fingerprint([messages[0]!, { role: 'assistant', text: 'Hi!' }]));
    expect(fingerprint(messages)).not.toBe(fingerprint([{ role: 'assistant', text: 'Hello.' }, messages[1]!]));
  });
});

describe('the window and the next span', () => {
  it('keeps raw the messages partly inside the window and always the last, and summarizes about batch tokens past it once they reach batch', () => {
    const tokens = [300, 300, 300, 300, 300, 300, 500, 200];
    expect(windowStart(tokens, 600)).toBe(6);
    expect(windowStart([5000], 600)).toBe(0);
    const settings = { window: 600, batch: 1000 };
    expect(nextSpan(tokens, 0, settings, 0)).toEqual({ from: 0, to: 3 });
    expect(nextSpan(tokens, 3, settings, 0)).toBeNull();
    expect(nextSpan(tokens, 3, settings, 1)).toEqual({ from: 3, to: 4 });
    expect(nextSpan([2000, 300], 0, { window: 300, batch: 1000 }, 0)).toEqual({ from: 0, to: 1 });
  });

  it('shrinks a memory budget past half of what the model can take, for that request only', () => {
    expect([memoryBudget(25_000, 30_000), memoryBudget(25_000, 100_000), memoryBudget(25_000, null)]).toEqual([15_000, 25_000, 25_000]);
  });
});
