import type { ConversationPrompt, TextBlock } from '../model/prompt';
import { unescapeCbs } from './cbs/escape';
import { previousMessages } from './cbs/history';
import { evaluate, Runaway, type CbsContext } from './cbs/evaluate';
import type { HistoryMessage } from './history';
import type { Card, Pack } from './import/types';
import type { LoreEntries } from './lorebook/activate';
import { progressed } from './progress';
import { Scripts, type Box } from './regex/scripts';

export type Stage = 'display' | 'prompt';

export type ChatScope = {
  card: Card | null;
  // 등장인물 (design §6.9), live ones only, in the order added.
  cast: { id: string; card: Card }[];
  // In order: the card's own first, so a script's place in the card's regex is its place among all the packs'.
  packs: Pack[];
  // Each null when the chat's is gone: the display still renders, and a turn stops before sending.
  persona: CbsContext['persona'];
  prompt: ConversationPrompt | null;
  // The chat's own 작가의 노트; null follows the prompt's.
  note: string | null;
  lore: (LoreEntries[number] & { parent: string | null })[];
  // The lorebook folders' names by the id of the pack or 등장인물 that holds them, for those that have any: block
  // triggers number a lorebook's entries with its folders first, as Risu's list holds them when they lead it.
  loreFolders: Record<string, string[]>;
  // 로어북 최대 분량: the most tokens the activated entries take.
  loreBudget: number;
  // Oldest first, each as its shown version.
  messages: HistoryMessage[];
  // The chat's own starting variables, over the card's defaults.
  variables: [string, string][];
  // The variables the bot's Lua wrote for the reply being made, which stand after the last message.
  pending?: [string, string][];
  greeting: CbsContext['greeting'];
  // The declared toggles' values, the one table a turn, the display and the bot's Lua globals read; a key nothing
  // declares reads null.
  toggles: ReadonlyMap<string, string | null>;
  model: CbsContext['model'];
  axModel: CbsContext['axModel'];
  clock: CbsContext['clock'];
  assets: CbsContext['assets'];
  inlays: CbsContext['inlays'];
  modules: CbsContext['modules'];
  faces: CbsContext['faces'];
  // The window the chat is shown in, which only the display reads; null in a turn and in a chat's preview.
  screen: CbsContext['screen'];
  // The character and the chat, which pick and rollp seed with a message count.
  pick: string;
};

// What crosses to a worker beside the messages, which travel as a tail (history-delta).
export type ChatBasis = Omit<ChatScope, 'messages'>;

// The bot's Lua editDisplay pass over the display, when its card listens for one (design §6.8): what a version's text
// became, as far as the pass has run. fresh: it was run on this text at this state; otherwise it is the last one made,
// shown until the new one lands. null: never run, and the message shows nothing until it is.
export type LuaDisplay = (version: string, text: string, stamp: string) => { text: string; fresh: boolean } | null;

export const authorNote = (note: string | null, prompt: ConversationPrompt) => note ?? prompt.authorNote;
const marked = (prompt: ConversationPrompt, mark: 'main' | 'globalNote') => prompt.blocks.find((block): block is TextBlock => block.kind === 'text' && block.mark === mark)?.text ?? '';

// toggles: the bot's Lua reads them from its globals as they stand mid-run.
export function contexts(scope: Omit<ChatScope, 'toggles' | 'cast'> & { toggles: Pick<ChatScope['toggles'], 'get'> }, stage: Stage, language: string | null, triggerId: string, unfound: CbsContext['unfound']): (source: CbsContext['source'], variables: Map<string, string>) => CbsContext {
  const { card, persona, prompt, note, messages, greeting, toggles, model, axModel, clock, assets, inlays, modules, faces, screen, pick } = scope;
  const fixed = {
    stage,
    card,
    persona,
    prompt: prompt && { main: marked(prompt, 'main'), globalNote: marked(prompt, 'globalNote'), authorNote: authorNote(note, prompt) },
    lore: scope.lore.map(({ value }) => value),
    messages,
    previous: previousMessages(messages),
    greeting,
    toggle: (key: string) => toggles.get(key) ?? null,
    model,
    axModel,
    triggerId,
    screen: stage === 'display' ? screen : null,
    clock,
    language,
    assets,
    inlays,
    unfound,
    modules,
    faces,
  };
  return (source, variables) => ({ ...fixed, source, variables, pickSeed: `${pick}:${'message' in source ? source.message : messages.length}` });
}

// The one pass that turns a chat's stored text into the text shown or sent, oldest message first. The input or
// output stage is the only one whose CBS writes variables, so a stage chained after it cannot run a setvar twice;
// the process or display stage reads a copy, so the display never changes what the prompt sees.
// take: the display scripts, by place among the packs' regex, whose boxes leave the messages (상태창 지정). drawn and
// boxes are each message's; only the display reads them. staged: each message's text past its input or output stage,
// which is what the bot's Lua reads; wrote: the variables that stage's own CBS wrote. missed: the messages whose
// editDisplay pass (lua) is not fresh. unfound: the asset names the display found no picture for, finish's included
// (null outside the display). stopped: a stage of some message whose CBS ran away, which leaves that stage's
// text as it came in, its tags as written; null when none did.
export function renderChat(
  stage: Stage,
  scope: ChatScope,
  take: ReadonlySet<number> = new Set(),
  lua?: LuaDisplay,
): { texts: string[]; staged: string[]; wrote: [string, string][][]; start: [string, string][]; variables: Map<string, string>; drawn: number[][]; boxes: Box[][]; missed: Missed[]; unfound: Set<string> | null; stopped: Runaway | null; finish: ((index: number, text: string) => ReturnType<typeof renderStage>) | null; failures: { input: Map<number, Runaway>; display: Map<number, Runaway> } } {
  const unfound = stage === 'display' ? new Set<string>() : null;
  const context = contexts(scope, stage, null, '', unfound);
  const scripts = new Scripts(scope.packs.flatMap(({ regex }) => regex), scope.messages);
  const start: [string, string][] = [...(scope.card?.variables ?? []), ...scope.variables];
  const variables = new Logged();
  if (lua) variables.changed = new Set();
  // Through set, so the stamp tells one start from another; then cleared, since a pass begins from start.
  for (const [name, value] of start) variables.set(name, value);
  variables.changed?.clear();
  const states = lua ? new VariableTimeline(start) : null;
  variables.record = states;
  const failures = { input: new Map<number, Runaway>(), display: new Map<number, Runaway>() };
  const first = scope.greeting === null ? 0 : 1;
  // Once a reply stands, the greeting's buttons write to the last message (runtime/scripts onLast), so the greeting
  // is read again below with the chat's current variables, as Risu reads it (ruled 2026-10-14).
  const later = first === 1 && scope.messages.length > 1;
  const missed: Missed[] = [];
  const wrote: [string, string][][] = [];
  const drawn: number[][] = [];
  const boxes: Box[][] = [];
  const past: string[] = [];
  let stopped: Runaway | null = null;
  // What the stage's CBS wrote before the stop stays written.
  const guarded = <T>(index: number, run: () => T, unrun: T): T => {
    try {
      return run();
    } catch (error) {
      if (!(error instanceof Runaway)) throw error;
      stopped ??= error;
      failures.input.set(index, error);
      return unrun;
    }
  };
  const texts = scope.messages.map(({ id, role, text, staged, before = [], after = [] }, index) => {
    states?.begin();
    progressed();
    const cbs = (read: Map<string, string>) => (part: string) => evaluate(part, context({ message: index }, read));
    // Neither the user nor the model wrote the greeting, so it skips their stages, as does a text already past them; its
    // CBS still writes. Risu reads a greeting afresh with the chat's state, so it reads what its buttons wrote: a bot's
    // opening picker shows the opening picked. Those writes still stand after its own.
    const greeting = index === 0 && scope.greeting !== null;
    const written = !(greeting || staged);
    for (const [name, value] of greeting ? [...before, ...after] : before) variables.set(name, value);
    variables.log = [];
    const replayed = guarded(index, () => written ? scripts.apply(role === 'user' ? 'input' : 'output', text, { index, cbs: cbs(variables) }).text : cbs(variables)(text), text);
    wrote.push(variables.log);
    variables.log = null;
    for (const [name, value] of after) variables.set(name, value);
    past.push(unescapeCbs(replayed));
    if (greeting && later) { drawn.push([]); boxes.push([]); return replayed; }
    let edited = replayed;
    if (lua) {
      // A pass is made again when its message's place or the state as of it changes, and for the last LATEST
      // messages when the chat grows or shrinks, which is when Risu draws them again: bots draw their status on the
      // last message and take it off the one before. Older messages keep their pass until reloadDisplay.
      const place = index - first;
      const length = scope.messages.length - first;
      const stamp = `${place}/${place >= length - LATEST ? length : ''}/${variables.stamp}`;
      const held = lua(id, replayed, stamp);
      if (!held?.fresh) {
        missed.push({ index: place, version: id, text: replayed, stamp, variables: [...variables.changed!].map((name) => [name, variables.get(name)!]) });
        variables.changed!.clear();
      }
      edited = held?.text ?? '';
    }
    const shown = renderStage(stage, scripts, context, index, edited, variables, take);
    if (shown.stopped) { stopped ??= shown.stopped; failures.display.set(index, shown.stopped); }
    drawn.push(shown.drawn);
    boxes.push(shown.boxes);
    return shown.text;
  });
  variables.record = null;
  for (const [name, value] of scope.pending ?? []) variables.set(name, value);
  if (later) {
    // Its own writes stood in order above; this reading's are dropped.
    const { id, text } = scope.messages[0]!;
    const replayed = guarded(0, () => evaluate(text, context({ message: 0 }, new Map(variables))), text);
    let edited = replayed;
    if (lua) {
      // The greeting shows the current state, so it is passed again whenever the chat grows or shrinks, as the last
      // LATEST messages are.
      const stamp = `-1/${scope.messages.length - first}/${variables.stamp}`;
      const held = lua(id, replayed, stamp);
      if (!held?.fresh) {
        missed.push({ index: -1, version: id, text: replayed, stamp, variables: [...variables.changed!].map((name) => [name, variables.get(name)!]) });
        variables.changed!.clear();
      }
      edited = held?.text ?? '';
    }
    const shown = renderStage(stage, scripts, context, 0, edited, variables, take);
    if (shown.stopped) { stopped ??= shown.stopped; failures.display.set(0, shown.stopped); }
    texts[0] = shown.text;
    drawn[0] = shown.drawn;
    boxes[0] = shown.boxes;
  }
  return { texts, staged: past, wrote, start, variables, drawn, boxes, missed, unfound, stopped, finish: states ? (index, text) => renderStage(stage, scripts, context, index, text, index === 0 && later ? variables : states.at(index), take) : null, failures };
}

function renderStage(stage: Stage, scripts: Scripts, context: ReturnType<typeof contexts>, index: number, text: string, variables: ReadonlyMap<string, string>, take: ReadonlySet<number>) {
  progressed();
  const read = new Map(variables);
  let stopped: Runaway | null = null;
  let result: { text: string; drawn: number[]; boxes: Box[] };
  try {
    result = scripts.apply(stage === 'prompt' ? 'process' : 'display', text, { index, take, cbs: (part) => evaluate(part, context({ message: index }, read)) });
  } catch (error) {
    if (!(error instanceof Runaway)) throw error;
    stopped = error;
    result = { text, drawn: [], boxes: [] };
  }
  return { text: unescapeCbs(result.text), drawn: result.drawn, boxes: result.boxes.map((box) => ({ ...box, html: unescapeCbs(box.html) })), stopped };
}

// Recorded by the canonical input/output pass, including before/after writes. A Lua result changes only a row's
// display stage; seeking these deltas preserves its original state without one full variable map per message.
class VariableTimeline {
  private readonly frames: [string, string, string | undefined][][] = [];
  private readonly values: Map<string, string>;
  private cursor = 0;
  constructor(start: [string, string][]) { this.values = new Map(start); }
  begin() { this.frames.push([]); }
  write(name: string, value: string, previous: string | undefined) { if (value !== previous) this.frames.at(-1)!.push([name, value, previous]); }
  at(index: number): ReadonlyMap<string, string> {
    while (this.cursor <= index) {
      for (const [name, value] of this.frames[this.cursor++]!) this.values.set(name, value);
    }
    while (this.cursor > index + 1) {
      const frame = this.frames[--this.cursor]!;
      for (let at = frame.length - 1; at >= 0; at--) {
        const [name, , previous] = frame[at]!;
        if (previous === undefined) this.values.delete(name);
        else this.values.set(name, previous);
      }
    }
    return this.values;
  }
}

const LATEST = 5;

// One message whose editDisplay pass is to be run. index: its place as Lua counts, the greeting -1. text: past its
// input or output stage, escaped braces still escaped, so the display's own CBS pass does not read them as tags.
// variables: the names written since the missed message before it, with their values as of this one.
export type Missed = { index: number; version: string; text: string; stamp: string; variables: [string, string][] };

// log: the writes of one stage, while it is set. changed and stamp follow every write that changes a value, for the
// editDisplay pass: the names since they were last taken, and a number that differs when the state does.
class Logged extends Map<string, string> {
  record: VariableTimeline | null = null;
  log: [string, string][] | null = null;
  changed: Set<string> | null = null;
  stamp = 0;
  override set(name: string, value: string) {
    this.record?.write(name, value, this.get(name));
    this.log?.push([name, value]);
    if (this.changed && this.get(name) !== value) {
      this.changed.add(name);
      for (const char of `${name}\0${value}\0`) this.stamp = Math.imul(this.stamp ^ char.charCodeAt(0), 16777619);
    }
    return super.set(name, value);
  }
}
