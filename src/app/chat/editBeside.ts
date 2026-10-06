import { useEffect, useRef } from 'react';
import { navigate } from '../shell/router';

// The open chat's character, whose editor that chat shows in its side panel.
let beside: { character: string; open: () => void } | null = null;

export function useEditBeside(character: string | null, open: () => void) {
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    if (character === null) return;
    const entry = { character, open: () => latest.current() };
    beside = entry;
    return () => {
      if (beside === entry) beside = null;
    };
  }, [character]);
}

// Beside the open chat when it is that character's chat, the editor's page otherwise.
export function openCharacterEditor(character: string) {
  if (beside?.character === character) beside.open();
  else navigate({ kind: 'edit', character });
}
