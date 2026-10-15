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
