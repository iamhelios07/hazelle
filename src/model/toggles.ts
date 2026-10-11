import { isToggle, type Toggle, type ToggleLine, type ToggleValues } from './prompt';

// Only toggles are declared; a layout line has no key to read. A key declared twice is one toggle, since conditions
// read one value per key; the first declaration is kept, so the prompt's over a pack's.
export function chatToggles(lines: readonly ToggleLine[]): Toggle[] {
  const keys = new Set<string>();
  return lines.filter(isToggle).filter(({ key }) => !keys.has(key) && keys.add(key));
}

// null for a key nothing declares.
export function toggleValue(declared: readonly Toggle[], values: ToggleValues): (key: string) => string | null {
  const defaults = new Map(declared.map((toggle) => [toggle.key, toggle.default]));
  return (key) => (!defaults.has(key) ? null : Object.hasOwn(values, key) ? values[key]! : defaults.get(key)!);
}
