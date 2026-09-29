import { describe, expect, it } from 'vitest';
import type { Block } from '../../model/prompt';
import { cacheMarks } from './blocks';

const text = (id: string, cache?: true): Block => ({ id, name: null, kind: 'text', role: 'system', text: id, mark: null, ...(cache && { cache }) });
const chat = (id: string): Block => ({ id, name: null, kind: 'slot', slot: 'chat', range: { from: 0, to: null } });

describe('cacheMarks', () => {
  it('draws the engine’s two points before the first chat block and after the last, and a block’s own over them', () => {
    const marks = cacheMarks([text('rules', true), text('premise'), chat('past'), chat('last'), text('note')]);
    expect(Object.fromEntries(marks)).toEqual({ rules: 'set', premise: 'auto', last: 'auto' });
    expect(Object.fromEntries(cacheMarks([chat('only'), text('note', true)]))).toEqual({ only: 'auto', note: 'set' });
  });
});
