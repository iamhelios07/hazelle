import { expect, it } from 'vitest';
import { convertPreset } from './preset';

it("keeps a preset's toggle lines in order, one it cannot read as written and counted", () => {
  const read = convertPreset({ name: 'p', promptTemplate: [], customPromptTemplateToggle: '=모드=group\nsims=시뮬레이터\n==groupEnd\n=안내=caption\n모드 고르기' });
  if (!read.ok) throw new Error(read.failure.kind);
  expect(read.prompt.toggles).toEqual([
    { kind: 'group', label: '모드' },
    { key: 'sims', label: '시뮬레이터', kind: 'check', default: '0' },
    { kind: 'groupEnd' },
    { kind: 'caption', label: '안내' },
    { kind: 'unread', text: '모드 고르기' },
  ]);
  expect(read.unsupported).toContainEqual({ kind: 'toggle-line', count: 1 });
});

it('places a persona, description, memory or author note item that names no role as a system slot', () => {
  const template = ['persona', 'description', 'memory', 'authornote'].map((type) => ({ type, innerFormat: '' }));
  const read = convertPreset({ name: 'p', promptTemplate: [...template, { type: 'persona', role: 'narrator' }] });
  if (!read.ok) throw new Error(read.failure.kind);
  expect(read.prompt.blocks.map((block) => [block.kind === 'slot' && block.slot, 'role' in block && block.role])).toEqual([
    ['persona', 'system'],
    ['description', 'system'],
    ['memory', 'system'],
    ['authorNote', 'system'],
  ]);
  expect(read.unsupported).toContainEqual({ kind: 'unread-item', count: 1 });
});
