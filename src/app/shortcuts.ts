import { useEffect, useRef } from 'react';
import { formatKeys, pressed, type Chord } from './ui';

type Shortcut = { label: string; hint: string; keys: readonly Chord[] };

// label names the shortcut in 단축키; hint is the shorter word of the hint lines and button titles. A modifier a
// chord leaves out is not checked, so Ctrl+Enter still sends and Ctrl+Shift+Enter still saves an edit.
export const SHORTCUTS = {
  // Ctrl+S too (user, 2026-09-29). Its handler must never pass the key on, or the browser's save-page dialog opens.
  settings: { label: '설정 열기 · 닫기', hint: '설정', keys: [{ key: ',', mod: true }, { key: 's', mod: true }] },
  personas: { label: '페르소나 (채팅에서는 옆 패널)', hint: '페르소나', keys: [{ key: 'e', mod: true }] },
  prompts: { label: '프롬프트 (채팅에서는 옆 패널)', hint: '프롬프트', keys: [{ key: 'p', mod: true }] },
  shortcutList: { label: '단축키 보기', hint: '단축키', keys: [{ key: '/', mod: true }] },
  sidebar: { label: '사이드바 접기 · 펴기', hint: '사이드바', keys: [{ key: 'b', mod: true }] },
  send: { label: '보내기', hint: '보내기', keys: [{ key: 'Enter', shift: false }] },
  newline: { label: '줄바꿈', hint: '줄바꿈', keys: [{ key: 'Enter', shift: true }] },
  stop: { label: '답장 멈추기', hint: '멈추기', keys: [{ key: 'Escape' }] },
  editLast: { label: '내 마지막 메시지 수정', hint: '내 메시지 수정', keys: [{ key: 'ArrowUp' }] },
  // The first key steps back, the second forward, and from the last version asks for a new one.
  swipe: { label: '답장 넘기기 · 끝에서 새로 받기', hint: '답장 넘기기', keys: [{ key: 'ArrowLeft' }, { key: 'ArrowRight' }] },
  saveEdit: { label: '수정 저장', hint: '저장', keys: [{ key: 'Enter', mod: true }] },
  cancelEdit: { label: '수정 취소', hint: '취소', keys: [{ key: 'Escape' }] },
  undo: { label: '되돌리기', hint: '되돌리기', keys: [{ key: 'z', mod: true, shift: false }] },
  redo: { label: '다시 하기', hint: '다시 하기', keys: [{ key: 'z', mod: true, shift: true }, { key: 'y', mod: true }] },
} as const satisfies Record<string, Shortcut>;

type Name = keyof typeof SHORTCUTS;

// Where each shortcut works, in the order 단축키 lists them.
export const SHORTCUT_GROUPS: readonly { title: string; note?: string; names: readonly Name[] }[] = [
  { title: '어디서나', names: ['settings', 'personas', 'prompts', 'shortcutList', 'sidebar'] },
  { title: '채팅', note: '입력창에서 동작해요. 화살표는 입력창이 비어 있을 때만 써요.', names: ['send', 'newline', 'stop', 'editLast', 'swipe', 'saveEdit', 'cancelEdit'] },
  { title: '프롬프트 편집', note: '블록과 토글을 고친 것을 되돌려요. 글 칸 안에서는 글자를 되돌려요.', names: ['undo', 'redo'] },
];

// false passes the key on, to the handler mounted before this one and then to the browser. Without an event it
// was run from a button or menu.
type Handler = (event?: KeyboardEvent) => boolean | void;

// Newest last. The one window listener below serves them all, so a screen claims a key by mounting a handler for it.
// fallback: the shell's own answer, which every screen's handler for the same keys comes before. Mount order cannot
// decide that, since React runs a child's effects before its parent's.
type Entry = { name: Name; run: Handler; fallback: boolean };
const handlers: Entry[] = [];

const inTurn = () => [...handlers.filter((entry) => !entry.fallback).reverse(), ...handlers.filter((entry) => entry.fallback).reverse()];

function onKey(event: KeyboardEvent) {
  // A key a focused control already took, such as Ctrl+Enter saving an edit, is not a shortcut.
  if (event.defaultPrevented) return;
  const press = { key: event.key, code: event.code, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, nativeEvent: event };
  for (const { name, run } of inTurn()) {
    if (!pressed(press, SHORTCUTS[name].keys) || run(event) === false) continue;
    event.preventDefault();
    return;
  }
}

export function useShortcut(name: Name, handler: Handler, { fallback = false } = {}) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const entry = { name, run: (event?: KeyboardEvent) => latest.current(event), fallback };
    if (handlers.length === 0) window.addEventListener('keydown', onKey);
    handlers.push(entry);
    return () => {
      handlers.splice(handlers.indexOf(entry), 1);
      if (handlers.length === 0) window.removeEventListener('keydown', onKey);
    };
  }, [name, fallback]);
}

// What the shortcut's keys would do, for a button or menu item that does the same.
export function runShortcut(name: Name) {
  for (const entry of inTurn()) if (entry.name === name && entry.run() !== false) return;
}

export const hints = (...shortcuts: Shortcut[]) => shortcuts.map((shortcut) => `${formatKeys(shortcut.keys)} ${shortcut.hint}`).join(' · ');

export const titled = (label: string, keys: readonly Chord[]) => `${label} · ${formatKeys(keys)}`;
