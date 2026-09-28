import { useState } from 'react';

// Unsent text per chat, kept while the page is open. A new chat's is kept under NEW, per character.
const drafts = new Map<string, string>();
const NEW = 'new';

export function useDraft(chat: string | null, character: string | null) {
  const key = chat ?? (character ? `${NEW}-${character}` : NEW);
  const [text, setText] = useState(() => drafts.get(key) ?? '');

  const set = (next: string) => {
    drafts.set(key, next);
    setText(next);
  };

  // Text a chat did not keep goes back into that chat's draft, which is another key's when a new
  // chat got its id before the text was lost.
  const putBack = (id: string, next: string) => {
    drafts.set(id, next);
    if (id === key) setText(next);
  };

  return { text, set, putBack };
}
