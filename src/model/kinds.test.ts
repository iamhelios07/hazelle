import { expect, it } from 'vitest';
import { isValue } from './kinds';

it("reads a summary's verdict as absent or well formed, and refuses a malformed one", () => {
  const summary = { version: 1, head: 0, chatRev: 1, dependencies: [], rendered: { now: 0, timeZone: 'UTC' }, character: null, title: '', preview: '', count: 0, at: null, order: 1, recent: [] };
  expect(isValue('summary', summary)).toBe(true);
  expect(isValue('summary', { ...summary, stuck: { dependencies: [{ kind: 'character', id: 'c', rev: 2 }] } })).toBe(true);
  expect(isValue('summary', { ...summary, stuck: null })).toBe(false);
  expect(isValue('summary', { ...summary, stuck: { dependencies: 'c' } })).toBe(false);
});

it('accepts an illustration as the run stores it, and refuses one whose scene lost a field', () => {
  const scene = { paragraph: 1, shape: 'portrait', setting: '1girl, indoors', framing: 'cowboy shot', characters: [{ name: 'Ari', look: 'girl, silver hair', outfit: 'white dress', action: 'smile', x: 0.5, y: 0.5 }] };
  const sent = { prompt: '1girl, indoors', negative: 'lowres', characters: [{ prompt: 'girl', negative: '', center: { x: 0.5, y: 0.5 } }], width: 832, height: 1216, seed: 7 };
  const illustration = { message: 'm', version: 'v', scene, receipt: null, model: { connection: 'c', model: 'nai' }, sent, file: { id: 'f', key: 'k' }, type: 'image/png', size: 10, at: 1 };
  expect(isValue('illustration', illustration)).toBe(true);
  expect(isValue('illustration', { ...illustration, scene: { ...scene, framing: undefined } })).toBe(false);
});


it('accepts tool files and per-key data without changing existing module shapes', () => {
  const manifest = { api: 1, name: 'notes', author: 'jin', displayName: 'Notes', version: '1', description: '', uses: [], page: null, menu: [], settings: [] };
  const tool = { manifest, file: { id: 'f', key: 'k' }, size: 30, settings: {} };
  expect(isValue('tool', tool)).toBe(true);
  expect(isValue('tool', { ...tool, file: {} })).toBe(false);
  expect(isValue('tool', { ...tool, manifest: { ...manifest, api: 2 } })).toBe(false);
  expect(isValue('tooldata', { key: 'note', value: { text: 'hello' } })).toBe(true);
  expect(isValue('tooldata', { key: 'note', value: null })).toBe(true);
  expect(isValue('tooldata', { key: 'note' })).toBe(false);
});
