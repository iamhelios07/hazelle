// A key as KeyboardEvent.key names it. A modifier set here must be in that state; one left out is not
// checked, so Ctrl+Enter still sends and Ctrl+Shift+Enter still saves an edit.
type Chord = { key: string; shift?: boolean; mod?: boolean };
type Shortcut = { label: string; hint: string; keys: readonly Chord[] };

// label names the shortcut in 단축키; hint is the shorter word of the hint lines and button titles.
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

type Press = { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; keyCode: number; nativeEvent: { isComposing: boolean } };

const matches = (event: Press, { key, shift, mod }: Chord) =>
  event.key === key && (shift === undefined || shift === event.shiftKey) && (mod === undefined || mod === (event.ctrlKey || event.metaKey));

// Which of the shortcut's keys was pressed, or -1. A key pressed while a Korean syllable is still being
// composed is never a shortcut, so Enter cannot send it half-typed.
export function pressedKey(event: Press, shortcut: Shortcut): number {
  if (event.nativeEvent.isComposing || event.keyCode === 229) return -1;
  return shortcut.keys.findIndex((chord) => matches(event, chord));
}

export const pressed = (event: Press, shortcut: Shortcut) => pressedKey(event, shortcut) !== -1;

const NAMES: Record<string, string> = { Escape: 'Esc', ArrowUp: '↑', ArrowLeft: '←', ArrowRight: '→' };
const caps = ({ key, shift, mod }: Chord) => [...(mod ? ['Ctrl'] : []), ...(shift ? ['Shift'] : []), NAMES[key] ?? key];
const written = (keys: readonly Chord[]) => keys.map((chord) => caps(chord).join('+')).join(' ');

export const SHORTCUT_LIST = Object.values(SHORTCUTS).map((shortcut) => ({ label: shortcut.label, keys: shortcut.keys.flatMap(caps) }));

export const hints = (...shortcuts: Shortcut[]) => shortcuts.map((shortcut) => `${written(shortcut.keys)} ${shortcut.hint}`).join(' · ');

export const titled = (label: string, keys: readonly Chord[]) => `${label} · ${written(keys)}`;
