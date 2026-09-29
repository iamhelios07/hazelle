import { useState } from 'react';

// A per-device convenience remembered in localStorage, such as the folded sidebar. Storage may be refused and an old
// value may not parse, so either way it starts as initial: nothing that must not be lost belongs here.
export function usePersisted<T>(key: string, parse: (stored: string) => T, initial: T, format: (value: T) => string = JSON.stringify): [T, (next: T) => void] {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? initial : parse(stored);
    } catch {
      return initial;
    }
  });

  const remember = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, format(next));
    } catch {
      // Kept for this page only.
    }
  };

  return [value, remember];
}
