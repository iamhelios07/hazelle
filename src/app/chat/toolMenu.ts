import type { ToolMenu } from '../../runtime/tools/facade';

export type ToolAction = { module: string; name: string; label: string } & ({ kind: 'page' } | { kind: 'menu'; item: string });

export const toolMenu = (tools: ToolMenu[]): ToolAction[] => tools.flatMap(({ module, manifest }) => [
  ...(manifest.page ? [{ kind: 'page' as const, module, name: manifest.displayName, label: manifest.page.label }] : []),
  ...manifest.menu.map(({ id, label }) => ({ kind: 'menu' as const, module, name: manifest.displayName, label, item: id })),
]);
