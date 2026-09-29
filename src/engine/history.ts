// One chat message as the engine reads it: the shown version's id, which lorebook matches name; the seed its
// random tags roll from (design §5 row 11), which is its id unless a branch or 이어 쓰기 kept an earlier one's
// (model/chat Entry); its role, its stored text, and when it was written.
export type HistoryMessage = { id: string; seed: string; role: 'user' | 'assistant'; text: string; time: number | null };
