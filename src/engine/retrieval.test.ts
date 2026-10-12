import { describe, expect, it } from 'vitest';
import type { Memory, MemoryRecord } from '../model/memory';
import type { ChatRead, RecordStatus } from './memory';
import { dequantize, nearest, quantize, rank, retrieval, RETRIEVED_HEADING } from './retrieval';

const vector = (...values: number[]) => quantize(values, 0);

describe('vectors', () => {
  it('quantizes a unit vector to a byte a dimension and reads it back within rounding', () => {
    const values = Array.from({ length: 64 }, (_, index) => Math.sin(index) * (index % 3 === 0 ? 0.01 : 1));
    const stored = quantize(values, 7);
    expect(stored.at).toBe(7);
    expect(stored.data).toHaveLength(Math.ceil(64 / 3) * 4);
    const back = dequantize(stored);
    const length = Math.hypot(...values);
    values.forEach((value, index) => expect(back[index]).toBeCloseTo(value / length, 2));
  });

  it('ranks nearest first and leaves out a vector of another length', () => {
    const items = { a: vector(1, 0, 0), b: vector(0.6, 0.8, 0), c: vector(0, 0, 1), other: vector(1, 0) };
    expect(rank([0.9, 0.1, 0], items).map(({ id }) => id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the nearest that beat the median by the gap, at most three, and none while fewer than four have vectors', () => {
    const ranked = (...similarities: number[]) => similarities.map((similarity, index) => ({ id: `r${index}`, similarity }));
    expect(nearest(ranked(0.9, 0.2, 0.1))).toEqual([]);
    expect(nearest(ranked(0.9, 0.55, 0.3, 0.2))).toEqual(['r0', 'r1']);
    expect(nearest(ranked(0.9, 0.86, 0.65, 0.5, 0.1, 0.1, 0.1))).toEqual(['r0', 'r1', 'r2']);
    expect(nearest(ranked(0.5, 0.45, 0.44, 0.43))).toEqual([]);
    expect(nearest(ranked(0.58, 0.5, 0.5, 0.5, 0.5))).toEqual(['r0']);
  });
});

describe('retrieval', () => {
  const texts = ['We reach the lighthouse.', 'Luna opens the door.', 'I promise to come back.', 'Luna nods.'];
  const chat: ChatRead = { shown: texts.map((_, index) => ({ message: `m${index}`, version: `v${index}` })), roles: ['user', 'assistant', 'user', 'assistant'], speakers: ['jin', 'Luna', 'jin', 'Luna'], texts };
  const record = (id: string, indices: number[], over: Partial<MemoryRecord> = {}): MemoryRecord => ({ id, sources: indices.map((index) => chat.shown[index]!), print: '', when: null, where: null, who: [], what: `What ${id}.`, lines: [], outcome: '', state: [], opens: [], closes: [], receipt: null, at: 0, ...over });
  const memory: Memory = { records: [record('r1', [0, 1]), record('r2', [2, 3]), record('r3', [2], { recalled: true }), record('r4', [3], { forgotten: true })], chapters: [], state: [], threads: [] };
  const standing = (status: Record<string, RecordStatus>) => ({ status: new Map(Object.entries(status)) });
  const chars = (text: string) => text.length;

  it('gives a sent record its messages, one over the budget or in its chapter its summary, and skips put-in, forgotten and stale ones', () => {
    const found = retrieval(memory, ['r2', 'r1', 'r3', 'r4'], standing({ r1: 'over', r2: 'sent', r3: 'sent', r4: 'forgotten' }), chat, 1000, chars)!;
    expect(found.ids).toEqual(['r2', 'r1']);
    expect(found.text).toBe(`${RETRIEVED_HEADING}\n\n[When: unknown · Where: unknown]\nThe messages, word for word:\njin: I promise to come back.\nLuna: Luna nods.\n\n[When: unknown · Where: unknown]\nWhat r1.`);
    expect(retrieval(memory, ['r1'], standing({ r1: 'chaptered' }), chat, 1000, chars)!.text).toContain('What r1.');
    expect(retrieval(memory, ['r1'], standing({ r1: 'stale' }), chat, 1000, chars)).toBeNull();
    expect(retrieval(memory, ['gone'], standing({}), chat, 1000, chars)).toBeNull();
  });

  it('takes each found record only while it fits the room left', () => {
    const summary = '[When: unknown · Where: unknown]\nWhat r1.'.length;
    const found = retrieval(memory, ['r2', 'r1'], standing({ r1: 'over', r2: 'sent' }), chat, summary, chars)!;
    expect(found.ids).toEqual(['r1']);
    expect(retrieval(memory, ['r1'], standing({ r1: 'over' }), chat, summary - 1, chars)).toBeNull();
  });
});
