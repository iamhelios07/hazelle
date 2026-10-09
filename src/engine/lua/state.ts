import type { PackOwner } from '../../model/library';
import { UNSET, type Host } from '../script-api';
import { unescapeCbs } from '../cbs/escape';
import { evaluate, Runaway } from '../cbs/evaluate';
import { TOGGLE_GLOBAL } from '../cbs/tags';
import { contexts, type ChatScope } from '../render';

// A message as a script reads it: role and data are Risu's names, which bots index by.
export type LuaMessage = { role: 'user' | 'char'; data: string; time: number };

// The chat as a run finds it. messages: without the greeting, each as it stands after the bot's input or output
// scripts. variables: as of the point in the story the run stands at. globals: what getGlobalVar reads, which is the
// chat's toggle values. scope: what CBS in a script's text is evaluated over and where its lorebook is read from: the
// chat's scope without what does not cross to a worker or no tag reads (its toggles, which globals carry, its packs,
// its cast).
export type Snapshot = {
  messages: LuaMessage[];
  variables: [string, string][];
  globals: [string, string][];
  scope: Omit<ChatScope, 'toggles' | 'packs' | 'pending' | 'cast'>;
  character: { name: string; description: string; firstMessage: string };
  persona: { name: string; description: string };
  note: string;
};

export type Working = { origin: number | null; role: 'user' | 'char'; data: string; time: number; first: string };

// One run's view of the chat, which the Lua API and the block effects read and change. quiet: an editDisplay pass,
// whose writes are dropped and which reaches nothing outside itself. variables is never written: a run's writes stand
// over it in written, so a display pass over many messages copies nothing. ranAway: the last cbs() call ran away; the
// error Lua raises for it reaches the run as another Error, never the Runaway.
export type Run = {
  owner: PackOwner | null;
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
  ranAway: boolean;
};
export type Acting = Run & { host: Host; owner: PackOwner };

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

const CONTEXTS = new WeakMap<Snapshot, ReturnType<typeof contexts>>();

// A script's text with its CBS evaluated over the chat as the run found it, with the run's variable writes so far over
// the snapshot's. What the run did to the messages is not seen, as in Risu, and a setvar in the text writes nothing.
// The prompt's stage: a tag only the display reads stays as written, for the display to read once the text is a
// message's.
export function cbs(run: Run, value: string): string {
  let context = CONTEXTS.get(run.snapshot);
  if (!context) {
    context = contexts({ ...run.snapshot.scope, packs: [], toggles: { get: (key) => run.globals.get(`${TOGGLE_GLOBAL}${key}`) } }, 'prompt', null);
    CONTEXTS.set(run.snapshot, context);
  }
  run.ranAway = false;
  try {
    return unescapeCbs(evaluate(value, context({ seed: crypto.randomUUID() }, new Map([...run.variables, ...run.written]))));
  } catch (error) {
    run.ranAway = error instanceof Runaway;
    throw error;
  }
}
