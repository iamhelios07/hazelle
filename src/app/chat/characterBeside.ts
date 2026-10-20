import { useEffect, useRef } from 'react';
import { navigate } from '../shell/router';
import { characterPage } from '../shell/routes';

// The open chat's character, which that chat shows in its side panel.
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

// Beside the open chat when it is that character's chat, the character's page otherwise.
export function openCharacter(character: string, wide: boolean) {
  if (beside?.character === character) beside.open();
  else navigate(characterPage(character, wide));
}
