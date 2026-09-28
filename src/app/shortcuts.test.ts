import { describe, expect, it } from 'vitest';
import { hints, pressed, pressedKey, SHORTCUT_LIST, SHORTCUTS, titled } from './shortcuts';

const press = (key: string, { shift = false, ctrl = false, meta = false, composing = false, keyCode = 0 } = {}) => ({
  key,
  shiftKey: shift,
  ctrlKey: ctrl,
  metaKey: meta,
  keyCode,
  nativeEvent: { isComposing: composing },
});

describe('shortcuts', () => {
  it('writes the hints, titles and 단축키 rows the chat shows', () => {
    expect(hints(SHORTCUTS.stop)).toBe('Esc 멈추기');
    expect(hints(SHORTCUTS.send, SHORTCUTS.newline)).toBe('Enter 보내기 · Shift+Enter 줄바꿈');
    expect(hints(SHORTCUTS.send, SHORTCUTS.editLast, SHORTCUTS.swipe)).toBe('Enter 보내기 · ↑ 내 메시지 수정 · ← → 답장 넘기기');
    expect(hints(SHORTCUTS.cancelEdit, SHORTCUTS.saveEdit)).toBe('Esc 취소 · Ctrl+Enter 저장');
    expect(titled(SHORTCUTS.send.hint, SHORTCUTS.send.keys)).toBe('보내기 · Enter');
    expect(titled(SHORTCUTS.stop.hint, SHORTCUTS.stop.keys)).toBe('멈추기 · Esc');
    expect(titled('이전', [SHORTCUTS.swipe.keys[0]])).toBe('이전 · ←');
    expect(titled('새 답장 받기', [SHORTCUTS.swipe.keys[1]])).toBe('새 답장 받기 · →');
    expect(SHORTCUT_LIST).toEqual([
      { label: '보내기', keys: ['Enter'] },
      { label: '줄바꿈', keys: ['Shift', 'Enter'] },
      { label: '답장 멈추기', keys: ['Esc'] },
      { label: '내 마지막 메시지 수정', keys: ['↑'] },
      { label: '답장 넘기기 · 끝에서 새로 받기', keys: ['←', '→'] },
      { label: '수정 저장', keys: ['Ctrl', 'Enter'] },
      { label: '수정 취소', keys: ['Esc'] },
    ]);
  });

  it('checks only the modifiers a key names', () => {
    expect(pressed(press('Enter'), SHORTCUTS.send)).toBe(true);
    expect(pressed(press('Enter', { ctrl: true }), SHORTCUTS.send)).toBe(true);
    expect(pressed(press('Enter', { shift: true }), SHORTCUTS.send)).toBe(false);
    expect(pressed(press('Enter'), SHORTCUTS.saveEdit)).toBe(false);
    expect(pressed(press('Enter', { meta: true }), SHORTCUTS.saveEdit)).toBe(true);
    expect(pressed(press('Enter', { ctrl: true, shift: true }), SHORTCUTS.saveEdit)).toBe(true);
    expect(pressedKey(press('ArrowLeft', { shift: true }), SHORTCUTS.swipe)).toBe(0);
    expect(pressedKey(press('ArrowRight'), SHORTCUTS.swipe)).toBe(1);
    expect(pressedKey(press('ArrowUp'), SHORTCUTS.swipe)).toBe(-1);
  });

  it('takes no key for a shortcut while a syllable is being composed', () => {
    expect(pressed(press('Enter', { composing: true }), SHORTCUTS.send)).toBe(false);
    expect(pressed(press('Enter', { keyCode: 229 }), SHORTCUTS.send)).toBe(false);
    expect(pressed(press('Enter', { ctrl: true, composing: true }), SHORTCUTS.saveEdit)).toBe(false);
    expect(pressed(press('Escape', { composing: true }), SHORTCUTS.cancelEdit)).toBe(false);
  });
});
