import { expect, it } from 'vitest';
import { notePreview } from './ChatTranslate';

it('previews each 번역가의 노트 by its first line under its own name, and an empty one not at all', () => {
  expect(notePreview('\n  Master -> 주인님\n존댓말 유지', '레이: 반말')).toEqual(['전역 · Master -> 주인님', '캐릭터 · 레이: 반말']);
  expect(notePreview('  \n', '<char>는 이름 그대로')).toEqual(['캐릭터 · <char>는 이름 그대로']);
  expect(notePreview(undefined, undefined)).toEqual([]);
});
