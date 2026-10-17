// id is the shown version's, which lorebook matches name; message is the message's, the same across its versions; seed is what its random tags roll from, which is its id
// unless a branch or 이어 쓰기 kept an earlier one's. staged: its text is already past the input or output stage
// (model/chat Entry). before, after: the variables the bot's Lua wrote before and after the version's own text is read
// (model/chat Entry). byHand: the user's own writes, set after after (model/chat Version).
export type HistoryMessage = { id: string; message: string; seed: string; role: 'user' | 'assistant'; text: string; time: number | null; staged?: true; before?: [string, string][]; after?: [string, string][]; byHand?: [string, string][] };
