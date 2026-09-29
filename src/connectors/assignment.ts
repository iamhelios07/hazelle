import type { Model, Modality } from './types';

// Roles are declared by the features that need a model (design §4.1); a feature that needs a model
// for a new purpose adds its role here. A role that no layer sets takes the role it falls back to,
// so every chain ends at 본 대화.
export type Role = 'main' | 'aux' | 'memory' | 'translate' | 'emotion';

export const ROLES: Record<Role, { needs: Modality; fallsBackTo: Role | null }> = {
  main: { needs: 'text', fallsBackTo: null },
  aux: { needs: 'text', fallsBackTo: 'main' },
  memory: { needs: 'text', fallsBackTo: 'aux' },
  translate: { needs: 'text', fallsBackTo: 'aux' },
  emotion: { needs: 'text', fallsBackTo: 'aux' },
};

export type ModelRef = { connection: string; model: string };
export type Assignment = Partial<Record<Role, ModelRef>>;

// Layers run from the most specific to 전체 기본값. Every layer is asked for the role before the chain
// moves on, so a 번역 set in 전체 기본값 outranks a 보조 set in the chat.
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
