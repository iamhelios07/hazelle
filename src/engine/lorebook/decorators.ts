// One `@@name value` line from the leading block of a lorebook entry (risu-compat-spec §b, Decorator syntax).
// value is the rest of the line as written, not split on commas: @@inject_replace and @@inject_lore take text
// that may hold a comma, and only key-list decorators split it (args).
export type DecoratorLine = { name: string; value: string };
// fallbacks: the `@@@name` lines right after it, tried in order when this decorator is not handled.
export type Decorator = DecoratorLine & { fallbacks: DecoratorLine[] };

export function parseDecorators(content: string): { decorators: Decorator[]; body: string } {
  const lines = content.trim().split(/\r?\n/);
  const decorators: Decorator[] = [];
  let at = 0;
  for (; at < lines.length && lines[at]!.startsWith('@@'); at++) {
    const fallback = lines[at]!.startsWith('@@@');
    const line = read(lines[at]!.slice(fallback ? 3 : 2));
    // @@@end is @@end, not a fallback. A @@@ line with no decorator before it has nothing to fall back from.
    if (fallback && line.name !== 'end') decorators.at(-1)?.fallbacks.push(line);
    else decorators.push({ ...line, fallbacks: [] });
  }
  return { decorators, body: lines.slice(at).join('\n').trim() };
}

function read(line: string): DecoratorLine {
  const space = line.indexOf(' ');
  return space === -1 ? { name: line, value: '' } : { name: line.slice(0, space), value: line.slice(space + 1).trim() };
}

export const args = (value: string) =>
  value
    .split(',')
    .map((arg) => arg.trim())
    .filter((arg) => arg !== '');
