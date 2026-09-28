import type { Card } from './import/types';

export type Stage = 'display' | 'prompt';

// Who a chat's text names: its character's card (null for a chat with none) and the user.
export type Scope = { card: Card | null; user: string };

export const CBS_TAG = /\{\{([^{}]*)\}\}/g;
// The tags this cut fills. engine/pipeline counts every other tag a card holds as not used yet.
export const FILLED = new Set(['char', 'bot', 'user']);

// The one place stored text becomes shown or sent text (design §5): chats store what the card and the
// user wrote, and fill it here each time.
// stage is not read yet. CBS and the regex stages branch on it (design §5 rows 1, 11, 14), so every
// caller already says which it renders for.
export function render(stage: Stage, text: string, { card, user }: Scope): string {
  return text.replace(CBS_TAG, (tag, inner: string) => {
    const name = inner.trim().toLowerCase();
    if (!FILLED.has(name)) return tag;
    if (name === 'user') return user;
    // With no character, {{char}} names no one and stays as written.
    return card ? card.nickname || card.name : tag;
  });
}
