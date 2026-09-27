import type { Model, Modality } from './types';

// Roles are declared by the features that need a model (design §4.1); a feature that needs a model
// for a new purpose adds its role here. 보조, 번역 and 이미지 arrive with the features that use them.
export type Role = 'main';

export const ROLES: Record<Role, { needs: Modality }> = { main: { needs: 'text' } };

export type ModelRef = { connection: string; model: string };
export type Assignment = Partial<Record<Role, ModelRef>>;

// Layers run from the most specific to 전체 기본값; the first layer that sets the role decides.
export function resolveRole(role: Role, layers: Assignment[]): ModelRef | null {
  for (const layer of layers) {
    const choice = layer[role];
    if (choice) return choice;
  }
  return null;
}

// A model whose output the catalog does not describe is offered: unknown is not "no".
export function fitsRole(model: Model, role: Role): boolean {
  return model.output === null || model.output.includes(ROLES[role].needs);
}
