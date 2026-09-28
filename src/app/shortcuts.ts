import { formatKeys, type Chord } from './ui';

type Shortcut = { label: string; hint: string; keys: readonly Chord[] };

// label names the shortcut in 단축키; hint is the shorter word of the hint lines and button titles. A modifier a
// chord leaves out is not checked, so Ctrl+Enter still sends and Ctrl+Shift+Enter still saves an edit.
export const SHORTCUTS = {
  send: { label: '보내기', hint: '보내기', keys: [{ key: 'Enter', shift: false }] },
  newline: { label: '줄바꿈', hint: '줄바꿈', keys: [{ key: 'Enter', shift: true }] },
  stop: { label: '답장 멈추기', hint: '멈추기', keys: [{ key: 'Escape' }] },
  editLast: { label: '내 마지막 메시지 수정', hint: '내 메시지 수정', keys: [{ key: 'ArrowUp' }] },
  // The first key steps back, the second forward, and from the last version asks for a new one.
  swipe: { label: '답장 넘기기 · 끝에서 새로 받기', hint: '답장 넘기기', keys: [{ key: 'ArrowLeft' }, { key: 'ArrowRight' }] },
  saveEdit: { label: '수정 저장', hint: '저장', keys: [{ key: 'Enter', mod: true }] },
  cancelEdit: { label: '수정 취소', hint: '취소', keys: [{ key: 'Escape' }] },
} as const satisfies Record<string, Shortcut>;

export const hints = (...shortcuts: Shortcut[]) => shortcuts.map((shortcut) => `${formatKeys(shortcut.keys)} ${shortcut.hint}`).join(' · ');

export const titled = (label: string, keys: readonly Chord[]) => `${label} · ${formatKeys(keys)}`;
