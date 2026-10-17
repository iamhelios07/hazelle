import type { Stored } from '../../model/kinds';
import type { PromptUse } from './usePromptUse';

// Only conversation prompts are filed (user ruling, 2026-10-17): the other kinds stay flat.
export const promptFolder = ({ value }: Stored<'prompt'>) => (value.task === undefined ? (value.folder ?? null) : null);

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

// A row stands for its copies too, which are shown under it: the latest use among them places it, and the unused go
// last by name.
export function byLastUse(uses: ReadonlyMap<string, PromptUse>, copies: ReadonlyMap<string, readonly Stored<'prompt'>[]>) {
  const last = (id: string): number => Math.max(uses.get(id)?.at ?? -1, ...(copies.get(id) ?? []).map((copy) => last(copy.id)));
  return (a: Stored<'prompt'>, b: Stored<'prompt'>) => last(b.id) - last(a.id) || byPromptName(a, b);
}
