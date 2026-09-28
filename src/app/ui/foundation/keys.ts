// A key as KeyboardEvent.key names it. A modifier set here must be in that state; one left out is not checked.
export type Chord = { key: string; shift?: boolean; mod?: boolean };

type KeyState = { isComposing: boolean; keyCode: number };
type Press = { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; nativeEvent: KeyState };

// A key pressed while an IME is still composing a syllable belongs to the syllable, so it is never a shortcut:
// Enter cannot send a Korean word half-typed, and Esc cannot close what it was typed into.
export const isComposing = (event: KeyState) => event.isComposing || event.keyCode === 229;

const matches = (event: Press, { key, shift, mod }: Chord) =>
  event.key === key && (shift === undefined || shift === event.shiftKey) && (mod === undefined || mod === (event.ctrlKey || event.metaKey));

// Which of the chords was pressed, or -1.
export function pressedKey(event: Press, chords: readonly Chord[]): number {
  if (isComposing(event.nativeEvent)) return -1;
  return chords.findIndex((chord) => matches(event, chord));
}

export const pressed = (event: Press, chords: readonly Chord[]) => pressedKey(event, chords) !== -1;

const NAMES: Record<string, string> = { Escape: 'Esc', ArrowUp: '↑', ArrowLeft: '←', ArrowRight: '→' };

// The caps a chord is pressed with, each one Kbd: Ctrl+Enter is ['Ctrl', 'Enter'].
export const keyCaps = ({ key, shift, mod }: Chord) => [...(mod ? ['Ctrl'] : []), ...(shift ? ['Shift'] : []), NAMES[key] ?? key];

// Chords in a line of text, such as a hint or a button's title: 'Ctrl+Enter', '← →'.
export const formatKeys = (chords: readonly Chord[]) => chords.map((chord) => keyCaps(chord).join('+')).join(' ');
