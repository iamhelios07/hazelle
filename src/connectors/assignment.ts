import type { Model, Modality } from './types';

// A role that no layer sets takes the role it falls back to, so every chain ends at 본 대화. A task (번역) has no
// role: its prompt holds its own model, and without one the task takes 보조.
export type Role = 'main' | 'aux';

export const ROLES: Record<Role, { needs: Modality; fallsBackTo: Role | null }> = {
  main: { needs: 'text', fallsBackTo: null },
  aux: { needs: 'text', fallsBackTo: 'main' },
};

export type ModelRef = { connection: string; model: string };
export type Assignment = Partial<Record<Role, ModelRef>>;

// Layers run from the most specific to 전체 기본값. Every layer is asked for the role before the chain
// moves on, so a 보조 set in 전체 기본값 outranks a 본 대화 set in the chat.
export function resolveRole(role: Role, layers: Assignment[]): ModelRef | null {
  for (const layer of layers) {
    const choice = layer[role];
    if (choice) return choice;
  }
  const next = ROLES[role].fallsBackTo;
  return next ? resolveRole(next, layers) : null;
}

// A model whose output the catalog does not describe is offered: unknown is not "no".
export function fitsRole(model: Model, role: Role): boolean {
  return model.output === null || model.output.includes(ROLES[role].needs);
}
