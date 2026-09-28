import { describe, expect, it } from 'vitest';
import { hints, SHORTCUTS, titled } from './shortcuts';

describe('shortcuts', () => {
  it('writes the hints and titles the chat shows', () => {
    expect(hints(SHORTCUTS.stop)).toBe('Esc 멈추기');
    expect(hints(SHORTCUTS.send, SHORTCUTS.newline)).toBe('Enter 보내기 · Shift+Enter 줄바꿈');
    expect(hints(SHORTCUTS.send, SHORTCUTS.editLast, SHORTCUTS.swipe)).toBe('Enter 보내기 · ↑ 내 메시지 수정 · ← → 답장 넘기기');
    expect(hints(SHORTCUTS.cancelEdit, SHORTCUTS.saveEdit)).toBe('Esc 취소 · Ctrl+Enter 저장');
    expect(titled(SHORTCUTS.send.hint, SHORTCUTS.send.keys)).toBe('보내기 · Enter');
    expect(titled(SHORTCUTS.stop.hint, SHORTCUTS.stop.keys)).toBe('멈추기 · Esc');
    expect(titled('이전', [SHORTCUTS.swipe.keys[0]])).toBe('이전 · ←');
    expect(titled('새 답장 받기', [SHORTCUTS.swipe.keys[1]])).toBe('새 답장 받기 · →');
  });
});
