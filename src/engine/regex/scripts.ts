import type { HistoryMessage } from '../history';
import type { RegexScript } from '../import/types';

export type Skipped = { script: RegexScript; reason: { kind: 'invalid'; detail: string } | { kind: 'emotion' } };

export type Context = {
  // In the caller's source order (spec §c); <order N> reorders them here.
  scripts: readonly RegexScript[];
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

// Runs the one CBS pass over the text itself, so the caller hands in the text before CBS.
// No result cache: Risu's froze random CBS in a replacement.
export function applyScripts(stage: RegexScript['stage'], text: string, { scripts, messages, index, cbs }: Context): { text: string; skipped: Skipped[] } {
  const skipped: Skipped[] = [];
  const run = scripts
    .filter((script) => script.stage === stage)
    .map((script) => ({ script, ...options(script.flags) }))
    .sort((a, b) => b.order - a.order);
  let result = cbs(text);
  for (const { script, flags, actions } of run) {
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
    if (kind === 'repeat_back') {
      const copied = matched ? null : repeatBack(result, once, argument.trim(), messages, index);
      if (copied !== null) result = cbs(copied);
    } else if (!matched) {
      continue;
    } else if (kind === 'move_top' || kind === 'move_bottom') {
      result = cbs(move(result, once, argument, kind === 'move_top'));
    } else {
      // inject: the match leaves this stage's text. Risu also rewrote the stored message; stored text is never
      // rewritten here, so that half has nothing to do.
      result = cbs(result.replace(regex, kind === 'inject' ? '' : argument));
    }
  }
  return { text: result, skipped };
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

// Only the first match moves. The native replace expands $1, $<name> and $& in the block; the slice cuts the
// expanded block back out of the replaced text.
function move(text: string, once: () => RegExp, block: string, top: boolean): string {
  const at = text.search(once());
  const rest = text.replace(once(), '');
  const replaced = text.replace(once(), block);
  const moved = replaced.slice(at, replaced.length - (rest.length - at));
  return top ? moved + rest : rest + moved;
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
