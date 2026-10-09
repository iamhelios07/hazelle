export type Json = Hazelle.Json;
export type Settings = Hazelle.Settings;
export type ToolUse = 'model' | 'embed' | 'memory';
// composer: the field is shown in the tool's composer popover too.
export type ToolField = { key: string; type: 'text' | 'number' | 'switch' | 'choice'; label: string; options?: string[]; default?: string | number | boolean; composer?: true };
// actions and composer are absent on a tool stored before they existed, which declares none.
export type ToolManifest = {
  api: 1; name: string; author: string; displayName: string; version: string; description: string; uses: ToolUse[]; page: { label: string } | null;
  menu: { id: string; label: string }[]; settings: ToolField[]; actions?: { id: string; label: string }[]; composer?: { label: string } | null;
};
