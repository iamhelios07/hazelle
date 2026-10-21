export type Json = Hazelle.Json;
export type Settings = Hazelle.Settings;
// Where every tool's own chat state lives among the chat's variables; the bot's are the rest.
export const TOOL_VARIABLES = 'tool:';
export const toolVar = (manifest: Pick<ToolManifest, 'author' | 'name'>, key: string) => `${TOOL_VARIABLES}${manifest.author}/${manifest.name}:${key}`;
export type ToolUse = 'model' | 'embed' | 'memory' | 'network';
// composer: the field is shown in the tool's composer popover too.
export type ToolField = { key: string; type: 'text' | 'number' | 'switch' | 'choice'; label: string; options?: string[]; default?: string | number | boolean; composer?: true };
// The import scan of a Risu v3 plugin (research/risu-plugin-adapter-plan.md §4). missing: Risu methods the file names that
// the adapter refuses or does not map yet. hosts: literal hosts in its code. 'unread': the API object is aliased, so its use
// could not be listed.
export type RisuScan = { verdict: 'all' | 'partial' | 'unread'; missing: string[]; hosts: string[] };
// actions and composer are absent on a tool stored before they existed, which declares none.
// risu: present only on a Risu v3 plugin, whose tool runs through the adapter.
export type ToolManifest = {
  api: 1; name: string; author: string; displayName: string; version: string; description: string; uses: ToolUse[]; page: { label: string } | null;
  menu: { id: string; label: string }[]; settings: ToolField[]; actions?: { id: string; label: string }[]; composer?: { label: string } | null; risu?: RisuScan;
};
