import { expect, it } from 'vitest';
import type { Display } from '../../engine/display';
import type { Receipt, Version } from '../../model/chat';
import type { Shown } from '../../runtime/talk';
import { logDraft, resolveLog } from './exportLog';

const picture = '0f8fad5b-d9cb-469f-a165-70867728950e';
const failed = { state: 'failed' } as Receipt;
const message = (id: string, role: Shown['role'], version: Partial<Version> = {}, live: string | null = null): Shown => ({ id, role, at: 0, selected: 0, live, versions: [{ id, seed: id, text: '', receipt: null, edited: false, at: 0, ...version }] });
const messages = [
  message('a', 'assistant', { translation: { text: '안녕', receipt: null, at: 0 } }),
  message('b', 'user'),
  message('c', 'assistant', { receipt: failed }),
  message('d', 'assistant'),
  message('e', 'assistant', {}, 'e'),
];
const view: Display = {
  texts: ['Hello', '반가워', 'broken', '', 'writing'],
  css: `.x { background: url(asset:${picture}) }`,
  drawn: [[], [], [], [], []],
  boxes: [[{ script: 0, html: '<b>HP 7</b>', at: 'bottom' }], [], [], [], []],
  pass: false,
  stopped: null,
};
const names = { character: { name: '루나', image: null }, me: { name: '진', image: null }, modelName: null };

it('draws the shown rows in range with their boxes, leaving out failed, empty and live ones, and collects their pictures', () => {
  const draft = logDraft(messages, view, new Set(), true, names, { pictures: true, hideMe: true, text: 'both', from: 1, to: 5 });
  expect(draft.rows.map(({ key, name, mine, stories }) => [key, name, mine, stories.length])).toEqual([['a', '루나', false, 3], ['b', '나', true, 1]]);
  expect(draft.rows[0]!.stories.map((story) => story.replace(/<[^>]+>/g, '').trim())).toEqual(['Hello', '안녕', 'HP 7']);
  expect([...draft.pictures.values()]).toEqual([{ kind: 'asset', id: picture }]);
  expect(resolveLog(draft, () => 'data:image/png;base64,AA').css).toBe('.x { background: url(data:image/png;base64,AA) }');
  expect(logDraft(messages, view, new Set(), true, names, { pictures: true, hideMe: false, text: 'translation', from: 2, to: 2 }).rows.map(({ name }) => name)).toEqual(['진']);
});

it('keeps a version flipped to its original on screen in its original, and shows the translation elsewhere', () => {
  const said = (flipped: Set<string>) => logDraft(messages, view, flipped, true, names, { pictures: true, hideMe: false, text: 'translation', from: 1, to: 1 }).rows[0]!.stories[0]!.replace(/<[^>]+>/g, '').trim();
  expect(said(new Set())).toBe('안녕');
  expect(said(new Set(['a']))).toBe('Hello');
});
