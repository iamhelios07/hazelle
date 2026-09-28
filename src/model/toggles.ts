import type { Toggle, ToggleValues } from './prompt';

// The toggles a chat declares (design §4.2): its prompt's, then its card's as read from the card's text. A key
// declared twice is one toggle, since conditions read one value per key; the prompt's declaration is kept.
export function chatToggles(prompt: readonly Toggle[], card: readonly Toggle[]): Toggle[] {
  const keys = new Set(prompt.map(({ key }) => key));
  return [...prompt, ...card.filter(({ key }) => !keys.has(key))];
}

// A declared toggle's value: the one set for the character, or for 캐릭터 없이, over its default. null for a key
// nothing declares.
export function toggleValue(declared: readonly Toggle[], values: ToggleValues): (key: string) => string | null {
  const defaults = new Map(declared.map((toggle) => [toggle.key, toggle.default]));
  return (key) => (!defaults.has(key) ? null : Object.hasOwn(values, key) ? values[key]! : defaults.get(key)!);
}
