import { isToggle, type Toggle, type ToggleLine, type ToggleMark, type ToggleValues } from './prompt';

// Only toggles are declared; a layout line has no key to read. A key declared twice is one toggle, since conditions
// read one value per key; the first declaration is kept, so the prompt's over a pack's.
export function chatToggles(lines: readonly ToggleLine[]): Toggle[] {
  const keys = new Set<string>();
  return lines.filter(isToggle).filter(({ key }) => !keys.has(key) && keys.add(key));
}

export type GroupHead = Extract<ToggleMark, { kind: 'group' }>;
// What a group holds, or the list outside its groups.
export type ToggleEntry = Exclude<ToggleLine, { kind: 'group' } | { kind: 'groupEnd' }>;
// Every line but a group's end, which shows only as where its group stops.
export type ShownLine = ToggleEntry | GroupHead;
export type LineAt<L extends ToggleLine = ToggleLine> = { line: L; at: number };
export type ToggleGroup = { head: LineAt<GroupHead>; members: LineAt<ToggleEntry>[]; end: LineAt | null };
export type ToggleNode = LineAt<ToggleEntry> | ToggleGroup;

// As Risu reads them: a group holds the lines after it up to its groupEnd or the next group, so groups do not nest,
// and a groupEnd with no group open holds nothing and is left out. Each line is the very one in the list, at its index.
export function toggleTree(lines: readonly ToggleLine[]): ToggleNode[] {
  const nodes: ToggleNode[] = [];
  let group: ToggleGroup | null = null;
  for (const [at, line] of lines.entries()) {
    if (line.kind === 'group') nodes.push((group = { head: { line, at }, members: [], end: null }));
    else if (line.kind === 'groupEnd') {
      if (group) group.end = { line, at };
      group = null;
    } else (group ? group.members : nodes).push({ line, at });
  }
  return nodes;
}

// A run of lines taken out at from and put back at to, counted in the list without them (model/fields moved).
export type LineMove = { from: number; count: number; to: number };

const firstOf = (node: ToggleNode) => ('head' in node ? node.head.at : node.at);
const lastOf = (node: ToggleNode) => ('head' in node ? (node.end?.at ?? node.members.at(-1)?.at ?? node.head.at) : node.at);

// One step past what shows beside the line at `at`: an entry moved past a group's head or end goes into or out of the
// group, and a group moves with all it holds. A group with no end of its own is not moved up past a lone line, which
// it would then hold.
export function lineMoves(nodes: readonly ToggleNode[], at: number): { up: LineMove | null; down: LineMove | null } {
  const index = nodes.findIndex((node) => firstOf(node) <= at && at <= lastOf(node));
  const node = nodes[index]!;
  const before = nodes[index - 1];
  const after = nodes[index + 1];
  const one = (to: number): LineMove => ({ from: at, count: 1, to });
  if (!('head' in node)) return { up: before ? one(lastOf(before)) : null, down: after ? one(firstOf(after)) : null };
  if (node.head.at === at) {
    const count = lastOf(node) - at + 1;
    return {
      up: before && (node.end !== null || 'head' in before) ? { from: at, count, to: firstOf(before) } : null,
      down: after ? { from: at, count, to: lastOf(after) - count + 1 } : null,
    };
  }
  const place = node.members.findIndex((member) => member.at === at);
  const next = node.members[place + 1];
  return {
    up: one(node.members[place - 1]?.at ?? node.head.at),
    down: next ? one(next.at) : node.end ? one(node.end.at) : after ? one(firstOf(after)) : null,
  };
}

export const keyInUse = (lines: readonly ToggleLine[], key: string) => lines.some((line) => isToggle(line) && line.key === key);

// The lines alone; what names the key elsewhere is its owner's to rewrite (app/prompts/edits rekey).
export const rekeyed = (lines: readonly ToggleLine[], from: string, to: string): ToggleLine[] => lines.map((line) => (isToggle(line) && line.key === from ? { ...line, key: to } : line));

// null for a key nothing declares.
export function toggleValue(declared: readonly Toggle[], values: ToggleValues): (key: string) => string | null {
  const defaults = new Map(declared.map((toggle) => [toggle.key, toggle.default]));
  return (key) => (!defaults.has(key) ? null : Object.hasOwn(values, key) ? values[key]! : defaults.get(key)!);
}
