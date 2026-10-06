import { describe, expect, it } from 'vitest';
import { SHORTCUT_GROUPS, SHORTCUTS, titled } from './shortcuts';

describe('shortcuts', () => {
  it('writes the titles the chat shows', () => {
    expect(titled(SHORTCUTS.send.label, SHORTCUTS.send.keys)).toBe('보내기 · Enter');
    expect(titled(SHORTCUTS.stop.label, SHORTCUTS.stop.keys)).toBe('응답 멈추기 · Esc');
    expect(titled('이전', [SHORTCUTS.swipe.keys[0]])).toBe('이전 · ←');
    expect(titled('새 답장 받기', [SHORTCUTS.swipe.keys[1]])).toBe('새 답장 받기 · →');
  });

  it('lists every shortcut in 단축키 once', () => {
    expect(SHORTCUT_GROUPS.flatMap((group) => group.names).sort()).toEqual(Object.keys(SHORTCUTS).sort());
  });
});
