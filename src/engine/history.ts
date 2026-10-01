// One chat message as the engine reads it. id is the shown version's, which lorebook matches name; seed is what its
// random tags roll from, which is its id unless a branch or 이어 쓰기 kept an earlier one's. staged: its text is already
// past the input or output stage (model/chat Entry).
export type HistoryMessage = { id: string; seed: string; role: 'user' | 'assistant'; text: string; time: number | null; staged?: true };
