import type { ConversationPrompt, TextBlock } from '../model/prompt';
import { unescapeCbs } from './cbs/escape';
import { evaluate, Runaway, type CbsContext } from './cbs/evaluate';
import type { HistoryMessage } from './history';
import type { Card, Pack } from './import/types';
import type { LoreInput } from './lorebook/activate';
import { applyScripts, type Box } from './regex/scripts';

export type Stage = 'display' | 'prompt';

export type ChatScope = {
  card: Card | null;
  // In order: the card's own first, so a script's place in the card's regex is its place among all the packs'.
  packs: Pack[];
  // Each null when the chat's is gone: the display still renders, and a turn stops before sending.
  persona: CbsContext['persona'];
  prompt: ConversationPrompt | null;
  // The chat's own 작가의 노트; null follows the prompt's.
  note: string | null;
  lore: LoreInput['entries'];
  // Oldest first, each as its shown version.
  messages: HistoryMessage[];
  // The chat's own starting variables, over the card's defaults.
  variables: [string, string][];
  // The variables the bot's Lua wrote for the reply being made, which stand after the last message.
  pending?: [string, string][];
  // The bot's Lua editDisplay pass over the display, when its card listens for one (design §6.8): what a version's
  // text became, as far as the pass has run. fresh: it was run on this text at this state; otherwise it is the last
  // one made, shown until the new one lands. null: never run, and the message shows nothing until it is.
  lua?: (version: string, text: string, stamp: string) => { text: string; fresh: boolean } | null;
  greeting: CbsContext['greeting'];
  toggle: CbsContext['toggle'];
  model: CbsContext['model'];
  clock: CbsContext['clock'];
  assets: CbsContext['assets'];
  modules: CbsContext['modules'];
  faces: CbsContext['faces'];
  // The window the chat is shown in, which only the display reads; null in a turn and in a chat's preview.
  screen: CbsContext['screen'];
  // The character and the chat, which pick and rollp seed with a message count.
  pick: string;
};

export const authorNote = (note: string | null, prompt: ConversationPrompt) => note ?? prompt.authorNote;
const marked = (prompt: ConversationPrompt, mark: 'main' | 'globalNote') => prompt.blocks.find((block): block is TextBlock => block.kind === 'text' && block.mark === mark)?.text ?? '';

// One chat's CBS contexts for a stage, by the text's source and the variables it reads. language: a translation's.
export function contexts(scope: ChatScope, stage: Stage, language: string | null): (source: CbsContext['source'], variables: Map<string, string>) => CbsContext {
  const { card, persona, prompt, note, messages, greeting, toggle, model, clock, assets, modules, faces, screen, pick } = scope;
  const fixed = {
    stage,
    card,
    persona,
    prompt: prompt && { main: marked(prompt, 'main'), globalNote: marked(prompt, 'globalNote'), authorNote: authorNote(note, prompt) },
    lore: scope.lore.map(({ value }) => value),
    messages,
    greeting,
    toggle,
    model,
    screen: stage === 'display' ? screen : null,
    clock,
    language,
    assets,
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
// editDisplay pass (scope.lua) is not fresh. stopped: a stage of some message whose CBS ran away, which leaves that stage's
// text as it came in, its tags as written; null when none did.
export function renderChat(
  stage: Stage,
  scope: ChatScope,
  take: ReadonlySet<number> = new Set(),
): { texts: string[]; staged: string[]; wrote: [string, string][][]; start: [string, string][]; variables: Map<string, string>; drawn: number[][]; boxes: Box[][]; missed: Missed[]; stopped: Runaway | null } {
  const context = contexts(scope, stage, null);
  const scripts = scope.packs.flatMap(({ regex }) => regex);
  const start: [string, string][] = [...(scope.card?.variables ?? []), ...scope.variables];
  const variables = new Logged();
  const lua = stage === 'display' ? scope.lua : undefined;
  if (lua) variables.changed = new Set();
  // Through set, so the stamp tells one start from another; then cleared, since a pass begins from start.
  for (const [name, value] of start) variables.set(name, value);
  variables.changed?.clear();
  const first = scope.greeting === null ? 0 : 1;
  const missed: Missed[] = [];
  const wrote: [string, string][][] = [];
  const drawn: number[][] = [];
  const boxes: Box[][] = [];
  const past: string[] = [];
  let stopped: Runaway | null = null;
  // What the stage's CBS wrote before the stop stays written.
  const guarded = <T>(run: () => T, unrun: T): T => {
    try {
      return run();
    } catch (error) {
      if (!(error instanceof Runaway)) throw error;
      stopped ??= error;
      return unrun;
    }
  };
  const texts = scope.messages.map(({ id, role, text, staged, before = [], after = [] }, index) => {
    const cbs = (read: Map<string, string>) => (part: string) => evaluate(part, context({ message: index }, read));
    const at = { messages: scope.messages, index };
    // Neither the user nor the model wrote the greeting, so it skips their stages, as does a text already past them; its
    // CBS still writes.
    const written = (index === 0 && scope.greeting !== null) || staged ? [] : scripts;
    for (const [name, value] of before) variables.set(name, value);
    variables.log = [];
    const replayed = guarded(() => applyScripts(role === 'user' ? 'input' : 'output', text, { ...at, scripts: written, cbs: cbs(variables) }).text, text);
    wrote.push(variables.log);
    variables.log = null;
    for (const [name, value] of after) variables.set(name, value);
    past.push(unescapeCbs(replayed));
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
    const shown = guarded(() => applyScripts(stage === 'prompt' ? 'process' : 'display', edited, { ...at, scripts, take, cbs: cbs(new Map(variables)) }), { text: edited, skipped: [], drawn: [], boxes: [] });
    drawn.push(shown.drawn);
    boxes.push(shown.boxes.map((box) => ({ ...box, html: unescapeCbs(box.html) })));
    return unescapeCbs(shown.text);
  });
  for (const [name, value] of scope.pending ?? []) variables.set(name, value);
  return { texts, staged: past, wrote, start, variables, drawn, boxes, missed, stopped };
}

const LATEST = 5;

// One message whose editDisplay pass is to be run. index: its place as Lua counts, the greeting -1. text: past its
// input or output stage, escaped braces still escaped, so the display's own CBS pass does not read them as tags.
// variables: the names written since the missed message before it, with their values as of this one.
export type Missed = { index: number; version: string; text: string; stamp: string; variables: [string, string][] };

// log: the writes of one stage, while it is set. changed and stamp follow every write that changes a value, for the
// editDisplay pass: the names since they were last taken, and a number that differs when the state does.
class Logged extends Map<string, string> {
  log: [string, string][] | null = null;
  changed: Set<string> | null = null;
  stamp = 0;
  override set(name: string, value: string) {
    this.log?.push([name, value]);
    if (this.changed && this.get(name) !== value) {
      this.changed.add(name);
      for (const char of `${name}\0${value}\0`) this.stamp = Math.imul(this.stamp ^ char.charCodeAt(0), 16777619);
    }
    return super.set(name, value);
  }
}
