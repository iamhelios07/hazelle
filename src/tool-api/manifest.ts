export type Json = Hazelle.Json;
export type Settings = Hazelle.Settings;
export type ToolField = { key: string; type: 'text' | 'number' | 'switch' | 'choice'; label: string; options?: string[]; default?: string | number | boolean };
export type ToolManifest = { api: 1; name: string; author: string; displayName: string; version: string; description: string; uses: 'model'[]; page: { label: string } | null; menu: { id: string; label: string }[]; settings: ToolField[] };
