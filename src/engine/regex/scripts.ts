import type { HistoryMessage } from '../history';
import type { RegexScript } from '../import/types';

// A box a script drew, taken out of the text (상태창 지정, design §6.4). script is its place in the caller's scripts.
// at: which end of the text it stood at, or for a box within the text, the end.
export type Box = { script: number; html: string; at: 'top' | 'bottom' };

export type Context = {
  // The scripts, by place, whose boxes are taken out of the text instead of drawn in it.
  take?: ReadonlySet<number>;
  // The place, in the messages the Scripts were built over, of the message the text belongs to: the stored message index
  // display uses, never a position in a filtered history.
  index: number;
  cbs: (text: string) => string;
};

const FLAG_CHARS = 'dgimsuvy';
const ACTIONS = ['move_top', 'move_bottom', 'repeat_back', 'inject'];
const DIRECTIVE = /^@@(emo|move_top|move_bottom|repeat_back|inject)(?:\s|$)/;
const append = (text: string, copy: string) => text + copy;
const PLACEMENTS = new Map([
  ['end', append],
  ['start', (text: string, copy: string) => copy + text],
  ['end_nl', (text: string, copy: string) => `${text}\n${copy}`],
  ['start_nl', (text: string, copy: string) => `${copy}\n${text}`],
]);

// What a box is made of: a script's replacement (or the block it moves) holding one of these draws a box; one of
// spans or marks only decorates the text.
const BOX_TAG = /<(?:div|table|details|section|article|aside|figure|center|img|ul|ol)\b/i;
// Around each replacement of a script whose box is taken: noncharacters, which no text carries (bots do use the
// private-use area).
const OPEN = '\uFDD0';
const CLOSE = '\uFDD1';
const TAKEN = new RegExp(`${OPEN}([\\s\\S]*?)${CLOSE}`, 'g');

type Pattern = { regex: RegExp; first: RegExp };
// pattern: null for a dynamic plan, compiled anew per message.
type Plan = { source: string; place: number; order: number; flags: string; dynamic: boolean; kind: string; argument: string; pattern: Pattern | null };

export class Scripts {
  private readonly plans: Record<RegexScript['stage'], Plan[]> = { input: [], output: [], process: [], display: [] };
  private readonly repeat: (pattern: RegExp, index: number, dynamic: boolean) => string | null;

  // Scripts are in source order (spec §c); <order N> reorders them here. History is raw, oldest first. An off script
  // keeps its place, so the places after it (상태창 지정) stay.
  constructor(scripts: readonly Script[], messages: readonly HistoryMessage[]) {
    this.repeat = latestMatches(messages);
    scripts.forEach((script, place) => {
      if (script.off) return;
      const plan = planOf(script, place);
      if (typeof plan !== 'string') this.plans[script.stage].push(plan);
    });
    for (const plans of Object.values(this.plans)) plans.sort((a, b) => b.order - a.order);
  }

  // Runs the one CBS pass over the text itself, so the caller hands in the text before CBS.
  // No result cache: Risu's froze random CBS in a replacement.
  // drawn: the scripts, by place, that drew a box in this text. A taken box goes on through the scripts after its
  // own, as it would have in the text: bots turn the <img src=name> of a status box into pictures with a later script.
  apply(stage: RegexScript['stage'], text: string, { take = new Set(), index, cbs }: Context): { text: string; drawn: number[]; boxes: Box[] } {
    const drawn: number[] = [];
    const boxes: Box[] = [];
    let result = cbs(text);
    for (const { source, place, flags, dynamic, kind, argument, pattern: fixed } of this.plans[stage]) {
      const pattern = dynamic ? compile(cbs(source), flags) : fixed;
      if (!pattern) continue;
      const regex = () => reset(pattern.regex);
      const once = () => reset(pattern.first);
      const matched = result.search(regex()) !== -1;
      if (kind === 'replace' || kind === 'inject') {
        for (const box of boxes) if (box.html.search(regex()) !== -1) box.html = cbs(box.html.replace(regex(), kind === 'inject' ? '' : argument));
      }
      if (kind === 'repeat_back') {
        const copied = matched ? null : this.repeat(once(), index, dynamic);
        if (copied !== null) result = cbs((PLACEMENTS.get(argument.trim()) ?? append)(result, copied));
      } else if (!matched) {
        continue;
      } else if (kind === 'move_top' || kind === 'move_bottom') {
        const { block, rest } = cut(result, once, argument);
        if (take.has(place)) boxes.push({ script: place, html: cbs(block), at: kind === 'move_top' ? 'top' : 'bottom' });
        if (take.has(place) || BOX_TAG.test(argument)) drawn.push(place);
        result = cbs(take.has(place) ? rest : kind === 'move_top' ? block + rest : rest + block);
      } else if (kind === 'replace' && take.has(place)) {
        const pieces: string[] = [];
        const marked = result.replace(regex(), OPEN + argument + CLOSE);
        result = cbs(
          marked.replace(TAKEN, (_, piece: string) => {
            pieces.push(piece);
            return '';
          }),
        );
        boxes.push({ script: place, html: cbs(pieces.join('')), at: marked.slice(0, marked.indexOf(OPEN)).trim() ? 'bottom' : 'top' });
        drawn.push(place);
      } else {
        // inject: the match leaves this stage's text. Risu also rewrote the stored message; stored text is never
        // rewritten here, so that half has nothing to do.
        result = cbs(result.replace(regex(), kind === 'inject' ? '' : argument));
        if (kind === 'replace' && BOX_TAG.test(argument)) drawn.push(place);
      }
    }
    return { text: result, drawn, boxes };
  }
}

// Risu copied from the previous same-role message only, and carried a match forward because the output stage
// rewrote that message in storage. Stored text stays as written, so the copy comes from the latest earlier same-role
// message that has a match, read raw.
// Each key holds only its latest match before through. Display patches come in descending disjoint stretches,
// each internally forward; a backwards seek scans only when that match lies beyond the requested message.
type MatchCursor = { through: number; last: { index: number; text: string } | null };
function latestMatches(messages: readonly HistoryMessage[]): (pattern: RegExp, index: number, dynamic: boolean) => string | null {
  const fixed = new Map<string, MatchCursor>();
  const dynamic = new Map<string, MatchCursor>();
  return (pattern, index, expanded) => {
    const role = messages[index]!.role;
    const key = JSON.stringify([pattern.source, pattern.flags, role]);
    const cache = expanded ? dynamic : fixed;
    const state = cache.get(key) ?? { through: 0, last: null };
    cache.delete(key);
    cache.set(key, state);
    // CBS may produce a different pattern for every message. Its cache must not retain a history per expansion.
    if (expanded && cache.size > 16) cache.delete(cache.keys().next().value!);
    if (index < state.through) {
      state.through = index;
      if (state.last && state.last.index >= index) {
        state.last = null;
        for (let at = index - 1; at >= 0; at--) {
          const message = messages[at]!;
          if (message.role !== role) continue;
          const match = reset(pattern).exec(message.text);
          if (match) { state.last = { index: at, text: match[0] }; break; }
        }
      }
    }
    for (; state.through < index; state.through++) {
      const message = messages[state.through]!;
      if (message.role !== role) continue;
      const match = reset(pattern).exec(message.text);
      if (match) state.last = { index: state.through, text: match[0] };
    }
    return state.last?.text ?? null;
  };
}

type Script = Omit<RegexScript, 'id'>;

// Why a script never runs. A <cbs> pattern is compiled only as it runs, so it is never found invalid here.
export type ScriptCheck = 'empty' | 'invalid' | 'unsupported';

function planOf(script: Pick<Script, 'find' | 'replace' | 'flags'>, place: number): Plan | ScriptCheck {
  const { flags, actions, order } = options(script.flags);
  const out = prepare(script.replace, actions);
  const directive = DIRECTIVE.exec(out);
  const kind = directive?.[1] ?? ACTIONS.find((action) => actions.has(action)) ?? 'replace';
  // Emotion images are not supported: an emo script does nothing.
  if (kind === 'emo') return 'unsupported';
  const dynamic = actions.has('cbs');
  const source = script.find;
  const pattern = dynamic ? null : compile(source, flags);
  if (!dynamic && !pattern) return source ? 'invalid' : 'empty';
  return { source, place, order, flags, dynamic, kind, argument: directive ? out.slice(directive[0].length) : out, pattern };
}

export const checkScript = (script: Pick<Script, 'find' | 'replace' | 'flags'>): ScriptCheck | null => {
  const plan = planOf(script, 0);
  return typeof plan === 'string' ? plan : null;
};

// One script over one text at its own stage, as a chat's first message, with no CBS run.
export function trySample(script: Script, text: string): string {
  return new Scripts([{ ...script, off: undefined }], [{ id: '', seed: '', role: 'assistant', text, time: null }]).apply(script.stage, text, { index: 0, cbs: (each) => each }).text;
}

function compile(source: string, flags: string): Pattern | null {
  // An empty pattern would match between every character.
  if (!source) return null;
  try {
    return { regex: new RegExp(source, flags), first: new RegExp(source, flags.replace('g', '')) };
  } catch {
    return null;
  }
}

// Neither global nor sticky lastIndex may carry over between searches or messages.
function reset(regex: RegExp): RegExp {
  regex.lastIndex = 0;
  return regex;
}

function options(flags: string | null): { flags: string; actions: Set<string>; order: number } {
  if (flags === null) return { flags: 'g', actions: new Set(), order: 0 };
  const actions = new Set<string>();
  let order = 0;
  for (const [, block] of flags.matchAll(/<([^>]*)>/g)) {
    for (const word of block!.split(',').map((part) => part.trim())) {
      const number = /^order\s+(-?\d+)$/.exec(word);
      if (number) order = Number(number[1]);
      else actions.add(word);
    }
  }
  const rest = flags.replace(/<[^>]*>/g, '').trim();
  // Risu turns flags with no valid letter into `u`, which changes what a pattern means; they mean no flags here.
  return { flags: rest ? [...new Set(rest)].filter((char) => FLAG_CHARS.includes(char)).join('') : 'g', actions, order };
}

// {{data}} is the whole match. The function form is the fix: as a replacement string,
// '$&' puts {{data}} itself back, which is how Risu's stayed literal.
function prepare(replace: string, actions: Set<string>): string {
  const out = replace.replaceAll('$n', '\n').replaceAll('{{data}}', () => '$&');
  return out.endsWith('>') && !actions.has('no_end_nl') ? `${out}\n` : out;
}

// Only the first match moves, as the block, out of the rest. The native replace expands $1, $<name> and $& in the
// block; the slice cuts the expanded block back out of the replaced text.
function cut(text: string, once: () => RegExp, block: string): { block: string; rest: string } {
  const at = text.search(once());
  const rest = text.replace(once(), '');
  const replaced = text.replace(once(), block);
  return { block: replaced.slice(at, replaced.length - (rest.length - at)), rest };
}
