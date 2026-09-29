import { stripComments } from '../cbs/parse';

// What a key is searched in: a chat message, or the body of an entry that fired in an earlier pass.
export type Source = { kind: 'message' | 'entry'; id: string };

// A scanned text, with CBS comments removed and prepared once for each way a key compares.
export type Scanned = { source: Source; text: string; compact: string; compactLower: string };

export type Matcher = (scanned: Scanned) => boolean;

export type KeyMode = { regex: boolean; caseSensitive: boolean; fullWord: boolean };

const SYNTAX = /[.*+?^${}()|[\]\\]/g;

export function scan(source: Source, text: string): Scanned {
  const stripped = stripComments(text);
  const compact = stripped.replace(/\s+/g, '');
  return { source, text: stripped, compact, compactLower: compact.toLowerCase() };
}

// search, not test: with the g or y flag test carries lastIndex from one text into the next.
const search = (pattern: RegExp): Matcher => (scanned) => scanned.text.search(pattern) !== -1;

// null for a regex key that does not compile.
export function compile(key: string, { regex, caseSensitive, fullWord }: KeyMode): Matcher | null {
  // With regex on, a key is a regex exactly when it starts with `/`; flags are optional and decide case
  // alone, so the entry's case setting does not reach it.
  if (regex && key.startsWith('/')) {
    const end = key.lastIndexOf('/');
    if (end === 0) return null;
    try {
      return search(new RegExp(key.slice(1, end), key.slice(end + 1)));
    } catch {
      return null;
    }
  }
  // A whole word ends where a letter or digit does not follow, so attached punctuation and particles in other
  // scripts do not block it, and a key of several words matches across any run of whitespace.
  if (fullWord) {
    const pattern = key.replace(SYNTAX, '\\$&').replace(/\s+/g, '\\s+');
    return search(new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, caseSensitive ? 'u' : 'iu'));
  }
  // Partial matching ignores spacing, which Korean text varies (risu-compat-spec §b, Key matching).
  const compact = key.replace(/\s+/g, '');
  if (caseSensitive) return (scanned) => scanned.compact.includes(compact);
  const lower = compact.toLowerCase();
  return (scanned) => scanned.compactLower.includes(lower);
}
