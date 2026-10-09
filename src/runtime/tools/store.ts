import type { Chat } from '../../model/chat';
import type { ToolUnit } from '../../model/tool';
import { packsOf } from '../chat-context';
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
export const TOOL_KEY_CHARS = 256;
export const TOOL_WRITES_PER_MINUTE = 30;
export const TOOL_NOTICES_PER_MINUTE = 3;
const WRITE_PAUSE_MS = 1000;
const RATE_WINDOW_MS = 60_000;
const jsonBytes = (value: Json) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

const dataBytes = (key: string, value: Json) => new TextEncoder().encode(key).byteLength + jsonBytes(value);

export class ToolRate {
  private readonly sent = new Map<string, number[]>();
  constructor(private readonly limit: number) {}

  take(key: string): boolean {
    const recent = (this.sent.get(key) ?? []).filter((at) => Date.now() - at < RATE_WINDOW_MS);
    this.sent.set(key, recent);
    if (recent.length >= this.limit) return false;
    recent.push(Date.now());
    return true;
  }
}

export function toolSettings(manifest: ToolManifest, values: Settings): Settings {
  const defaults = Object.fromEntries(manifest.settings.flatMap((field) => field.default === undefined ? [] : [[field.key, field.default]]));
  // Values survive a version that removes or changes a field; reverting code must not discard the user's settings.
  return { ...defaults, ...values };
}

export async function importTool(store: ObjectStore, files: Files, { manifest, bytes }: ImportedTool): Promise<ApiResult<ToolImport>> {
  if (bytes.byteLength > TOOL_FILE_BYTES) return { ok: false, error: 'too-large' };
  const existing = store.list('tool').find(({ value }) => value.manifest.name === manifest.name && value.manifest.author === manifest.author);
  // Reimport never revives a binned identity or leaves a second live copy beside it.
  if (existing && !live(store.get('module', existing.parent!))) return { ok: false, error: 'gone' };
  const uploaded = await files.save([bytes]);
  if (!uploaded.ok) return uploaded;
  const file = uploaded.data[0];
  if (!file) return { ok: false, error: 'tool-file-refused' };
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
  const saved = await store.update('tool', toolId(module), (current) => live(store.get('module', module)) ? { ...current, settings: { ...current.settings, ...Object.fromEntries(current.manifest.settings.flatMap((field) => Object.hasOwn(change, field.key) && fieldValue(field, change[field.key]) ? [[field.key, change[field.key]!]] : [])) } } : null);
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
  if (key.length > TOOL_KEY_CHARS) return { ok: false, error: 'key-too-long' };
  const bytes = dataBytes(key, value);
  if (bytes > TOOL_VALUE_BYTES || bytes + store.children('tooldata', module).reduce((sum, row) => sum + (row.value.key === key ? 0 : dataBytes(row.value.key, row.value.value)), 0) > TOOL_DATA_BYTES) return { ok: false, error: 'too-large' };
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


export const toolsOf = (store: ObjectStore, chat: Chat): ToolUnit[] => packsOf(store, chat).flatMap(({ id, module }) => {
  const tool = module && store.get('tool', toolId(id));
  return tool ? [{ module: id, tool: tool.value }] : [];
});

type PendingData = { value: Json | undefined; waiting: { resolve(): void; reject(error: Error): void }[] };
type DataQueue = { pending: Map<string, PendingData>; timer: ReturnType<typeof setTimeout> | null; running: boolean };

export class ToolWrites {
  private readonly queues = new Map<string, DataQueue>();
  private closed = false;
  private readonly rate = new ToolRate(TOOL_WRITES_PER_MINUTE);

  take(module: string) {
    if (this.closed) throw new Error('closed');
    if (!this.rate.take(module)) throw new Error('too-many-writes');
  }
  constructor(private readonly store: ObjectStore) {}

  async write(module: string, key: string, value: Json | undefined): Promise<void> {
    // The merge pause is part of the write's original timeline, not a new write after an account restore.
    const result = await this.store.pinned(() => this.enqueue(module, key, value));
    if (result && !result.ok) throw new Error(result.error);
  }

  private enqueue(module: string, key: string, value: Json | undefined): Promise<void> {
    if (this.closed) return Promise.reject(new Error('closed'));
    if (key.length > TOOL_KEY_CHARS) return Promise.reject(new Error('key-too-long'));
    if (value !== undefined && dataBytes(key, value) > TOOL_VALUE_BYTES) return Promise.reject(new Error('too-large'));
    const queue = this.queues.get(module) ?? { pending: new Map(), timer: null, running: false };
    this.queues.set(module, queue);
    const promise = new Promise<void>((resolve, reject) => {
      const pending = queue.pending.get(key);
      if (pending) { pending.value = value; pending.waiting.push({ resolve, reject }); }
      else queue.pending.set(key, { value, waiting: [{ resolve, reject }] });
    });
    this.schedule(module, queue);
    return promise;
  }

  cancel(module: string) {
    const queue = this.queues.get(module);
    if (!queue) return;
    if (queue.timer) clearTimeout(queue.timer);
    queue.timer = null;
    for (const pending of queue.pending.values()) for (const waiter of pending.waiting) waiter.reject(new Error('closed'));
    queue.pending.clear();
    // Rate history survives restarts and reimports of the same module.
  }

  close() {
    this.closed = true;
    for (const module of this.queues.keys()) this.cancel(module);
  }

  private schedule(module: string, queue: DataQueue) {
    if (this.closed || queue.timer || queue.running || !queue.pending.size) return;
    queue.timer = setTimeout(() => {
      queue.timer = null;
      void this.flush(module, queue);
    }, WRITE_PAUSE_MS);
  }

  private async flush(module: string, queue: DataQueue) {
    queue.running = true;
    const pending = [...queue.pending];
    queue.pending.clear();
    try {
      for (const [key, { value, waiting }] of pending) {
        try {
          if (this.closed) throw new Error('closed');
          this.take(module);
          const result = value === undefined ? await deleteToolData(this.store, module, key) : await setToolData(this.store, module, key, value);
          if (!result.ok) throw new Error(result.error);
          for (const waiter of waiting) waiter.resolve();
        } catch (error) {
          for (const waiter of waiting) waiter.reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    } finally {
      queue.running = false;
      this.schedule(module, queue);
    }
  }
}
