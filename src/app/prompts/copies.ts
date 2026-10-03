import type { Stored } from '../../model/kinds';

export const byPromptName = (a: Stored<'prompt'>, b: Stored<'prompt'>) => a.value.name.localeCompare(b.value.name, 'ko');

export function groupPrompts(prompts: readonly Stored<'prompt'>[]): { top: Stored<'prompt'>[]; copies: ReadonlyMap<string, readonly Stored<'prompt'>[]> } {
  const ids = new Set(prompts.map(({ id }) => id));
  const top: Stored<'prompt'>[] = [];
  const copies = new Map<string, Stored<'prompt'>[]>();
  // A copy sits under its original while that is still here.
  for (const prompt of prompts) {
    const origin = prompt.value.origin;
    if (!origin || !ids.has(origin.id)) {
      top.push(prompt);
      continue;
    }
    const group = copies.get(origin.id);
    if (group) group.push(prompt);
    else copies.set(origin.id, [prompt]);
  }
  for (const group of copies.values()) group.sort(byPromptName);
  return { top, copies };
}
