// A message as a script reads it: role and data are Risu's names, which bots index by.
export type LuaMessage = { role: 'user' | 'char'; data: string; time: number };

// The chat as a run finds it. messages: without the greeting, each as it stands after the bot's input or output
// scripts. variables: as of the point in the story the run stands at. globals: what getGlobalVar reads.
export type Snapshot = {
  messages: LuaMessage[];
  variables: [string, string][];
  globals: [string, string][];
  character: { name: string; description: string; firstMessage: string };
  persona: { name: string; description: string };
  note: string;
};

export type Question = { kind: 'input'; text: string } | { kind: 'confirm'; text: string } | { kind: 'select'; options: string[] };
export type ModelMessage = { role: 'system' | 'user' | 'assistant'; content: string };

// What a script reaches outside its run, each of which may take as long as the user or a provider does.
export type Host = {
  say(kind: 'normal' | 'error', text: string): void;
  // input: the text typed; confirm: 'yes'; select: the option's index. null: dismissed.
  ask(question: Question): Promise<string | null>;
  model(role: 'main' | 'aux', messages: ModelMessage[]): Promise<{ success: boolean; result: string }>;
  tokens(text: string): Promise<number>;
  // The text with its CBS evaluated over the chat as the run found it. written: the run's variable writes so far,
  // which stand over the snapshot's. What the run did to the messages is not seen, as in Risu.
  cbs(text: string, written: [string, string][]): Promise<string>;
};

export type Working = { origin: number | null; role: 'user' | 'char'; data: string; time: number; first: string };

// One run's view of the chat, which the Lua API and the block effects read and change. quiet: an editDisplay pass,
// whose writes are dropped and which reaches nothing outside itself. variables is never written: a run's writes stand
// over it in written, so a display pass over many messages copies nothing.
export type Run = {
  quiet: boolean;
  snapshot: Snapshot;
  variables: ReadonlyMap<string, string>;
  globals: ReadonlyMap<string, string>;
  written: Map<string, string>;
  messages: Working[];
  host: Host | null;
  stop: boolean;
  reload: boolean;
  missing: Set<string>;
};
export type Acting = Run & { host: Host };

export const UNSET = 'null';

export const working = (snapshot: Snapshot): Working[] => snapshot.messages.map((message, origin) => ({ ...message, origin, first: message.data }));

export const text = (value: unknown) => (value === undefined || value === null ? '' : String(value));

export const read = (run: Run, name: string) => run.written.get(name) ?? run.variables.get(name) ?? UNSET;

export function write(run: Run, name: string, value: unknown): boolean {
  const next = text(value);
  if ((run.written.get(name) ?? run.variables.get(name)) === next) return false;
  run.written.set(name, next);
  return true;
}

export const add = (run: Run, role: Working['role'], data: string) => void run.messages.push({ origin: null, role, data, time: Date.now(), first: '' });
