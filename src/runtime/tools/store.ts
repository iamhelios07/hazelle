import { fieldValue, TOOL_FILE_BYTES, type ImportedTool } from '../../engine/import/tool';
import { without } from '../../model/fields';
import { live } from '../../model/library';
import { toolId, type Tool } from '../../model/tool';
import type { Json, Settings, ToolManifest } from '../../tool-api/manifest';
import type { ApiResult } from '../api';
import type { Files } from '../files';
import type { Session } from '../session';
import type { ObjectStore } from '../store';

export type ToolImport = { id: string; previous: Tool | null };
export const TOOL_VALUE_BYTES = 512 * 1024;
export const TOOL_DATA_BYTES = 4 * 1024 * 1024;
const jsonBytes = (value: Json) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

export function toolSettings(manifest: ToolManifest, values: Settings): Settings {
  return Object.fromEntries(manifest.settings.flatMap((field) => {
    const value = Object.hasOwn(values, field.key) && fieldValue(field, values[field.key]) ? values[field.key] : field.default;
    return value === undefined ? [] : [[field.key, value]];
  }));
}

export async function importTool(store: ObjectStore, files: Files, { manifest, bytes }: ImportedTool): Promise<ApiResult<ToolImport>> {
  if (bytes.byteLength > TOOL_FILE_BYTES) return { ok: false, error: 'too-large' };
  const existing = store.list('tool').find(({ value }) => value.manifest.name === manifest.name && value.manifest.author === manifest.author);
  // Reimport never revives a binned identity or leaves a second live copy beside it.
  if (existing && !live(store.get('module', existing.parent!))) return { ok: false, error: 'gone' };
  const uploaded = await files.save([bytes]);
  if (!uploaded.ok) return uploaded;
  const file = uploaded.data[0];
  if (!file) return { ok: false, error: 'files-full' };
  const id = existing?.parent ?? crypto.randomUUID();
  const previous = existing?.value ?? null;
  const value: Tool = { manifest, file, size: bytes.byteLength, settings: toolSettings(manifest, previous?.settings ?? {}) };
  if (existing) {
    // Reset before the new code is visible; a failure can ask again but never grant a new capability silently.
    if (manifest.uses.some((use) => !existing.value.manifest.uses.includes(use))) {
      const reset = await store.update('module', id, (current) => current.deleted === undefined ? without(current, 'botModels') : null);
      if (!reset.ok) return reset;
    }
    const saved = await store.update('tool', existing.id, (current) => live(store.get('module', id)) ? { ...value, settings: toolSettings(manifest, current.settings) } : null);
    return saved.ok ? { ok: true, data: { id, previous } } : saved;
  }
  const saved = await store.batch([
    { type: 'create', kind: 'module', id, parent: null, value: { name: manifest.displayName, description: manifest.description, namespace: null, loreFolders: [], regex: [], triggers: [], toggles: '' } },
    { type: 'create', kind: 'tool', id: toolId(id), parent: id, value },
  ]);
  return saved.ok ? { ok: true, data: { id, previous: null } } : saved;
}

export const undoToolImport = (store: ObjectStore, module: string, previous: Tool) =>
  store.update('tool', toolId(module), (current) => live(store.get('module', module)) ? { ...previous, settings: toolSettings(previous.manifest, current.settings) } : null);

export async function setToolSettings({ store, tools }: Pick<Session, 'store' | 'tools'>, module: string, change: Settings): Promise<ApiResult<unknown>> {
  const saved = await store.update('tool', toolId(module), (current) => live(store.get('module', module)) ? { ...current, settings: toolSettings(current.manifest, { ...current.settings, ...change }) } : null);
  if (saved.ok) tools.settingsChanged(module);
  return saved;
}

// Every device addresses the same key. The module separates equal key names owned by different tools.
export async function toolDataId(module: string, key: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${module}\0${key}`)));
  const hex = [...digest.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const toolData = (store: ObjectStore, module: string, key: string): Json | undefined =>
  store.children('tooldata', module).find(({ value }) => value.key === key)?.value.value;
export const toolKeys = (store: ObjectStore, module: string): string[] => store.children('tooldata', module).map(({ value }) => value.key);

export async function setToolData(store: ObjectStore, module: string, key: string, value: Json): Promise<ApiResult<unknown>> {
  if (!live(store.get('module', module))) return { ok: false, error: 'gone' };
  const bytes = jsonBytes(value);
  if (bytes > TOOL_VALUE_BYTES || bytes + store.children('tooldata', module).reduce((sum, row) => sum + (row.value.key === key ? 0 : jsonBytes(row.value.value)), 0) > TOOL_DATA_BYTES) return { ok: false, error: 'too-large' };
  const id = await toolDataId(module, key);
  if (!store.get('tooldata', id)) {
    const created = await store.create('tooldata', { key, value }, { id, parent: module });
    if (created.ok || created.error !== 'conflict') return created;
  }
  return store.update('tooldata', id, () => ({ key, value }));
}

export async function deleteToolData(store: ObjectStore, module: string, key: string): Promise<ApiResult<null>> {
  const id = await toolDataId(module, key);
  return store.get('tooldata', id) ? store.remove(id) : { ok: true, data: null };
}
