import type { HistoryMessage } from '../history';
import type { RegexScript } from '../import/types';

export type Skipped = { script: RegexScript; reason: { kind: 'invalid'; detail: string } | { kind: 'emotion' } };

// A box a script drew, taken out of the text (옆에 고정, design §6.4). script is its place in the caller's scripts.
export type Box = { script: number; html: string };

export type Context = {
  // In the caller's source order (spec §c); <order N> reorders them here.
  scripts: readonly RegexScript[];
  // The scripts, by place, whose boxes are taken out of the text instead of drawn in it.
  take?: ReadonlySet<number>;
  // The chat as shown, oldest first, and the place in it of the message the text belongs to: the stored
  // message index display uses, never a position in a filtered history.
  messages: readonly HistoryMessage[];
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

// Runs the one CBS pass over the text itself, so the caller hands in the text before CBS.
// No result cache: Risu's froze random CBS in a replacement.
// drawn: the scripts, by place, that drew a box in this text. A taken box goes on through the scripts after its
// own, as it would have in the text: bots turn the <img src=name> of a status box into pictures with a later script.
export function applyScripts(
  stage: RegexScript['stage'],
  text: string,
  { scripts, take = new Set(), messages, index, cbs }: Context,
): { text: string; skipped: Skipped[]; drawn: number[]; boxes: Box[] } {
  const skipped: Skipped[] = [];
  const drawn: number[] = [];
  const boxes: Box[] = [];
  const run = scripts
    .map((script, place) => ({ script, place, ...options(script.flags) }))
    .filter(({ script }) => script.stage === stage)
    .sort((a, b) => b.order - a.order);
  let result = cbs(text);
  for (const { script, place, flags, actions } of run) {
    const out = prepare(script.replace, actions);
    const directive = DIRECTIVE.exec(out);
    const kind = directive?.[1] ?? ACTIONS.find((action) => actions.has(action)) ?? 'replace';
    if (kind === 'emo') {
      skipped.push({ script, reason: { kind: 'emotion' } });
      continue;
    }
    const source = actions.has('cbs') ? cbs(script.find) : script.find;
    // An empty pattern would match between every character.
    if (!source) continue;
    let regex: RegExp;
    try {
      regex = new RegExp(source, flags);
    } catch (error) {
      skipped.push({ script, reason: { kind: 'invalid', detail: error instanceof Error ? error.message : String(error) } });
      continue;
    }
    // A fresh regex per use, so no lastIndex carries over between searches.
    const once = () => new RegExp(source, flags.replace('g', ''));
    const argument = directive ? out.slice(directive[0].length) : out;
    const matched = result.search(regex) !== -1;
    if (kind === 'replace' || kind === 'inject') {
      for (const box of boxes) if (box.html.search(regex) !== -1) box.html = cbs(box.html.replace(regex, kind === 'inject' ? '' : argument));
    }
    if (kind === 'repeat_back') {
      const copied = matched ? null : repeatBack(result, once, argument.trim(), messages, index);
      if (copied !== null) result = cbs(copied);
    } else if (!matched) {
      continue;
    } else if (kind === 'move_top' || kind === 'move_bottom') {
      const { block, rest } = cut(result, once, argument);
      if (take.has(place)) boxes.push({ script: place, html: cbs(block) });
      if (take.has(place) || BOX_TAG.test(argument)) drawn.push(place);
      result = cbs(take.has(place) ? rest : kind === 'move_top' ? block + rest : rest + block);
    } else if (kind === 'replace' && take.has(place)) {
      const pieces: string[] = [];
      const marked = result.replace(regex, OPEN + argument + CLOSE);
      result = cbs(
        marked.replace(TAKEN, (_, piece: string) => {
          pieces.push(piece);
          return '';
        }),
      );
      boxes.push({ script: place, html: cbs(pieces.join('')) });
      drawn.push(place);
    } else {
      // inject: the match leaves this stage's text. Risu also rewrote the stored message; stored text is never
      // rewritten here, so that half has nothing to do.
      result = cbs(result.replace(regex, kind === 'inject' ? '' : argument));
      if (kind === 'replace' && BOX_TAG.test(argument)) drawn.push(place);
    }
  }
  return { text: result, skipped, drawn, boxes };
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

// Risu copied from the previous same-role message only, and carried a match forward because the output stage
// rewrote that message in storage. Stored text stays as written, so the search goes back to
// the latest same-role message that has a match.
function repeatBack(text: string, once: () => RegExp, mode: string, messages: readonly HistoryMessage[], index: number): string | null {
  const { role } = messages[index]!;
  for (let at = index - 1; at >= 0; at--) {
    const earlier = messages[at]!;
    const found = earlier.role === role ? once().exec(earlier.text) : null;
    if (found) return (PLACEMENTS.get(mode) ?? append)(text, found[0]);
  }
  return null;
}
