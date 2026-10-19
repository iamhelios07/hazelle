import type { CallCalibration } from './token-calibration';
import type { Receipt, Writes } from './chat';
import type { Source } from './memory';

// A generation call the server is making for a chat (tech-spec §6, Detached replies), kept until its result is saved,
// so a reload or another device picks it up. call: the connection and model with their names when it started. result:
// the id of the entry its result is saved as, or of a memory summary's first record or chapter, which tells a call already saved.
// for a memory summary of the message versions it read: the fingerprint (engine/memory) of their text as the prompt
// rendered it for the call. An answer picked up later is for that text, however the versions render then.
// How the call is held: key, the private key of a call the server makes (runtime/relay stream); batch, the provider's id
// of a reply submitted to a discount lane's batch (ConnectionType discount), which the page asks about through the relay.
export type Stream = ({ key: JsonWebKey } | { batch: string }) & {
  call: Pick<Receipt, 'connection' | 'source' | 'model' | 'modelName' | 'entry'>;
  calibration: CallCalibration;
  at: number;
  result: string;
  for:
    // follows: as a message's (model/chat Entry), absent on a call begun before it.
    | { kind: 'reply'; message: string | null; replaces: string | null; follows?: string | null; continues: { text: string; receipt: Receipt; seed: string; reasoning?: string } | null; before?: Writes }
    // spans: what the tokens in the translation's source stand for (engine/protect); absent on a call begun before it existed, or with none.
    | { kind: 'translation'; version: string; spans?: string[] }
    | { kind: 'input'; typed: string; language: string; follows?: string | null; spans?: string[] }
    | { kind: 'note'; character: string }
    // chapter: the records a chapter call summarizes again; absent for a records call.
    | { kind: 'memory'; sources: Source[]; print: string; chapter?: string[] };
};
