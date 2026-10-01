import { useState } from 'react';

// Unsent text per chat, kept while the page is open. A new chat's is kept under NEW, per character.
const drafts = new Map<string, string>();
const NEW = 'new';

export function useDraft(chat: string | null, character: string | null) {
  const key = chat ?? (character ? `${NEW}-${character}` : NEW);
  // The text is held with its key: a new chat's screen stays open when its first send saves it, and then shows the
  // draft under the chat's id.
  const [held, setHeld] = useState(() => ({ key, text: drafts.get(key) ?? '' }));
  if (held.key !== key) setHeld({ key, text: drafts.get(key) ?? '' });

  const set = (next: string) => {
    drafts.set(key, next);
    setHeld({ key, text: next });
  };

  // Text a chat did not keep goes back into that chat's draft, which is another key's when a new
  // chat got its id before the text was lost. The key shown now is the updater's: the send began under the old one.
  const putBack = (id: string, next: string) => {
    drafts.set(id, next);
    setHeld((current) => (current.key === id ? { key: id, text: next } : current));
  };

  return { text: held.text, set, putBack };
}
