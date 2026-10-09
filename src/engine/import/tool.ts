import { isRecord } from '../../connectors/values';
import type { Settings, ToolField, ToolManifest } from '../../tool-api/manifest';
import type { ImportFailure } from './types';

export const TOOL_FILE_BYTES = 8 * 1024 * 1024;
export type ImportedTool = { manifest: ToolManifest; bytes: Uint8Array<ArrayBuffer> };
export type ToolRead = { ok: true; tool: ImportedTool } | { ok: false; failure: ImportFailure };
const identity = (value: string) => /^[\p{L}\p{N}_.-]+$/u.test(value);

export function fieldValue(field: ToolField, value: unknown): value is Settings[string] {
  switch (field.type) {
    case 'text': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'switch': return typeof value === 'boolean';
    case 'choice': return typeof value === 'string' && !!field.options?.includes(value);
  }
}

function fieldOf(value: unknown): ToolField | null {
  if (!isRecord(value) || typeof value.key !== 'string' || !identity(value.key) || typeof value.label !== 'string' || !value.label.trim()) return null;
  if (value.type !== 'text' && value.type !== 'number' && value.type !== 'switch' && value.type !== 'choice') return null;
  if (value.type === 'choice' && (!Array.isArray(value.options) || value.options.length === 0 || !value.options.every((option) => typeof option === 'string'))) return null;
  const field: ToolField = { key: value.key, label: value.label, type: value.type, ...(value.type === 'choice' && { options: value.options as string[] }) };
  if (value.default !== undefined) {
    if (!fieldValue(field, value.default)) return null;
    field.default = value.default;
  }
  return field;
}

export function readTool(bytes: Uint8Array<ArrayBuffer>): ToolRead {
  const failed = (detail: string): ToolRead => ({ ok: false, failure: { kind: 'unreadable', detail } });
  if (bytes.byteLength > TOOL_FILE_BYTES) return failed('tool-too-large');
  let code: string;
  try { code = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return failed('tool-encoding'); }
  const header = new Map<string, string>();
  const manifest: ToolManifest = { api: 1, name: '', author: '', displayName: '', version: '', description: '', uses: [], page: null, menu: [], settings: [] };
  for (const line of code.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^\s*\/\/@([\w-]+)(?:\s+(.*))?$/.exec(line);
    if (!match) break;
    const [, key, raw] = match;
    const value = raw?.trim() ?? '';
    if (key === 'setting') {
      let json: unknown;
      try { json = JSON.parse(value); } catch { return failed('tool-setting'); }
      const field = fieldOf(json);
      if (!field || manifest.settings.some((each) => each.key === field.key)) return failed('tool-setting');
      manifest.settings.push(field);
    } else if (key === 'menu') {
      const item = /^(\S+)\s+(.+)$/.exec(value);
      if (!item || !identity(item[1]!) || manifest.menu.some((each) => each.id === item[1])) return failed('tool-menu');
      manifest.menu.push({ id: item[1]!, label: item[2]! });
    } else if (key === 'uses') {
      if (value !== 'model') return failed('tool-uses');
      manifest.uses = ['model'];
    } else header.set(key!, value);
  }
  if (header.get('api') !== '1') return failed('tool-api');
  const name = header.get('name') ?? '';
  const author = header.get('author') ?? '';
  if (!identity(name) || !identity(author)) return failed('tool-identity');
  Object.assign(manifest, { name, author, displayName: header.get('display-name') || name, version: header.get('version') ?? '', description: header.get('description') ?? '', page: header.get('page') ? { label: header.get('page')! } : null });
  return { ok: true, tool: { manifest, bytes } };
}
