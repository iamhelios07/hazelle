import { useState } from 'react';

// What a field shows: the text typed into it while that is not a value yet (its error shows) or still reads as the
// value the screen holds, and the value's own text once that is another, such as one saved from another device.
// read answers null for a text that is not a value.
export function typedText<V>(typed: string | undefined, read: (typed: string) => V | null, value: V, text: (value: V) => string): string {
  if (typed === undefined) return text(value);
  const meant = read(typed);
  return meant === null || meant === value ? typed : text(value);
}

export const filled = (typed: string) => (typed.trim() ? typed : null);

export function useTypedNumber<V>(read: (typed: string) => V | null, value: V, { error, onChange, text = (held) => (held === undefined ? '' : String(held)) }: { error: string; onChange: (value: V) => void; text?: (value: V) => string }) {
  const [typed, setTyped] = useState<string>();
  const shown = typedText(typed, read, value, text);
  return {
    text: shown,
    error: read(shown) === null ? error : undefined,
    change: (next: string) => {
      setTyped(next);
      const meant = read(next);
      if (meant !== null) onChange(meant);
    },
  };
}
