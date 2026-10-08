import type { Receipt, Writes } from './chat';
import type { Source } from './memory';

// A generation call the server is making for a chat (tech-spec §6, Detached replies), kept until its result is saved,
// so a reload or another device picks it up. call: the connection and model with their names when it started. result:
// the id of the entry its result is saved as, or of a memory summary's first record or chapter, which tells a call already saved.
// for a memory summary of the message versions it read: the fingerprint (engine/memory) of their text as the prompt
// rendered it for the call. An answer picked up later is for that text, however the versions render then.
export type Stream = {
  key: JsonWebKey;
  call: Pick<Receipt, 'connection' | 'source' | 'model' | 'modelName'>;
  at: number;
  result: string;
  for:
    | { kind: 'reply'; message: string | null; replaces: string | null; continues: { text: string; receipt: Receipt; seed: string; reasoning?: string } | null; before?: Writes }
    | { kind: 'translation'; version: string }
    | { kind: 'input'; typed: string; language: string }
    // chapter: the records a chapter call summarizes again; absent for a records call.
    | { kind: 'memory'; sources: Source[]; print: string; chapter?: string[] };
};
