import type { Toggle, ToggleValues } from './prompt';

// The toggles a chat declares: its prompt's, then its packs' as read from their text. A key declared twice is one
// toggle, since conditions read one value per key; the first declaration is kept, so the prompt's over a pack's.
export function chatToggles(prompt: readonly Toggle[], packs: readonly Toggle[]): Toggle[] {
  const keys = new Set<string>();
  return [...prompt, ...packs].filter(({ key }) => !keys.has(key) && keys.add(key));
}

// A declared toggle's value: the one set for the character, or for 캐릭터 없이, over its default. null for a key
// nothing declares.
export function toggleValue(declared: readonly Toggle[], values: ToggleValues): (key: string) => string | null {
  const defaults = new Map(declared.map((toggle) => [toggle.key, toggle.default]));
  return (key) => (!defaults.has(key) ? null : Object.hasOwn(values, key) ? values[key]! : defaults.get(key)!);
}
