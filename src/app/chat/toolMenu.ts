import type { Badges, ToolChatData } from '../../model/tool';
import type { ToolField } from '../../tool-api/manifest';
import type { ToolMenu } from '../../runtime/tools/facade';

export type ToolAction = { module: string; name: string; label: string } & ({ kind: 'page' } | { kind: 'menu'; item: string });

export const toolMenu = (tools: ToolMenu[]): ToolAction[] => tools.flatMap(({ module, manifest }) => [
  ...(manifest.page ? [{ kind: 'page' as const, module, name: manifest.displayName, label: manifest.page.label }] : []),
  ...manifest.menu.map(({ id, label }) => ({ kind: 'menu' as const, module, name: manifest.displayName, label, item: id })),
]);

// A message's 도구 menu: each tool's //@action items, by tool in pack order.
export type ToolActions = { module: string; name: string; items: { id: string; label: string }[] };
export const toolActions = (tools: ToolMenu[]): ToolActions[] => tools.flatMap(({ module, manifest }) => manifest.actions?.length ? [{ module, name: manifest.displayName, items: manifest.actions }] : []);

// A //@composer item: its button, and the settings fields it shows, which are the module's own in every chat.
export type ToolComposer = { module: string; name: string; label: string; fields: ToolField[]; page: boolean };
export const toolComposer = (tools: ToolMenu[]): ToolComposer[] => tools.flatMap(({ module, manifest }) => manifest.composer ? [{
  module, name: manifest.displayName, label: manifest.composer.label, fields: manifest.settings.filter((field) => field.composer), page: manifest.page !== null,
}] : []);

const BADGE_CHARS = 10;

// Each version's badges, one a tool, in pack order. A badge stands on the version it was put on: another version shown
// hides it, and showing that one again brings it back.
export function badgesByVersion(rows: readonly { value: ToolChatData }[], tools: ToolMenu[]): ReadonlyMap<string, string[]> {
  const order = new Map(tools.map(({ module }, index) => [module, index]));
  const records = rows.flatMap(({ value }) => (value.key === null && order.has(value.module) ? [value] : [])).sort((a, b) => order.get(a.module)! - order.get(b.module)!);
  const versions = new Map<string, string[]>();
  for (const { value } of records) {
    for (const { version, text } of Object.values(value as Badges)) {
      const badge = [...text].slice(0, BADGE_CHARS).join('');
      const badges = versions.get(version);
      if (badges) badges.push(badge);
      else versions.set(version, [badge]);
    }
  }
  return versions;
}
