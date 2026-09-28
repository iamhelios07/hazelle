// One chat message as the engine reads it: the shown version's id, which seeds the random tags in its
// text (design §5 row 11), its role, its stored text, and when it was written.
export type HistoryMessage = { id: string; role: 'user' | 'assistant'; text: string; time: number | null };
