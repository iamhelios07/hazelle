import { expect, it } from 'vitest';
import type { Stored } from '../../model/kinds';
import { byLastUse, groupPrompts } from './promptCopies';

const prompt = (id: string, name: string, origin?: string): Stored<'prompt'> => ({
  id, kind: 'prompt', parent: null, rev: 1,
  value: { name, blocks: [], toggles: [], authorNote: '', models: {}, ...(origin === undefined ? {} : { origin: { id: origin, name: '원본' } }) },
});
const ids = (prompts: readonly Stored<'prompt'>[]) => prompts.map(({ id }) => id);

it('sorts each original’s copies stably while promoting orphans and keeping nested copies attached', () => {
  const prompts = [prompt('z', '다', 'root'), prompt('root', '원본'), prompt('orphan', '사본', 'missing'), prompt('a2', '가', 'root'), prompt('nested', '하위', 'orphan'), prompt('own', '별개'), prompt('a1', '가', 'root'), prompt('leaf', '더 아래', 'a2')];
  const before = [...prompts];
  const grouped = groupPrompts(prompts);
  expect(ids(grouped.top)).toEqual(['root', 'orphan', 'own']);
  expect(ids(grouped.copies.get('root')!)).toEqual(['a2', 'a1', 'z']);
  expect(ids(grouped.copies.get('orphan')!)).toEqual(['nested']);
  expect(ids(grouped.copies.get('a2')!)).toEqual(['leaf']);
  expect(grouped.top.length + [...grouped.copies.values()].reduce((sum, group) => sum + group.length, 0)).toBe(prompts.length);
  expect(prompts).toEqual(before);

  const removed = groupPrompts(prompts.filter(({ id }) => id !== 'root'));
  expect(ids(removed.top)).toEqual(['z', 'orphan', 'a2', 'own', 'a1']);
  expect(ids(removed.copies.get('a2')!)).toEqual(['leaf']);
  expect(removed.copies.has('root')).toBe(false);
});

it('places a row by the latest use among it and its copies, the unused last by name', () => {
  const prompts = [prompt('b', '나'), prompt('a', '가'), prompt('old', '오래'), prompt('root', '원본'), prompt('copy', '원본 (사본)', 'root')];
  const uses = new Map([['old', { chats: 1, at: 10 }], ['copy', { chats: 1, at: 20 }]]);
  const { top, copies } = groupPrompts(prompts);
  expect(ids(top.toSorted(byLastUse(uses, copies)))).toEqual(['root', 'old', 'a', 'b']);
});
