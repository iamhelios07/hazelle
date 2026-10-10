import type { Chat } from '../../model/chat';
import type { ToolUnit } from '../../model/tool';
import { packsOf } from '../chat-context';
import { fieldValue, type ImportedTool } from '../../engine/import/tool';
import { without } from '../../model/fields';
import { live } from '../../model/library';
import { toolId, type Badges, type Tool } from '../../model/tool';
import type { Json, Settings, ToolManifest } from '../../tool-api/manifest';
import type { ApiResult } from '../api';
import type { Files } from '../files';
import type { Session } from '../session';
import type { ObjectStore, Write } from '../store';

export type ToolImport = { id: string; previous: Tool | null };
export const TOOL_VALUE_BYTES = 512 * 1024;
export const TOOL_DATA_BYTES = 4 * 1024 * 1024;
export const TOOL_CHAT_BYTES = 8 * 1024 * 1024;
export const TOOL_KEY_CHARS = 256;
const TOOL_WRITES_PER_MINUTE = 30;
export const TOOL_NOTICES_PER_MINUTE = 3;
const WRITE_PAUSE_MS = 1000;
const RATE_WINDOW_MS = 60_000;
const encoder = new TextEncoder();
const dataBytes = (key: string, value: Json) => encoder.encode(key).byteLength + encoder.encode(JSON.stringify(value)).byteLength;

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

function toolSettings(manifest: ToolManifest, values: Settings): Settings {
  const defaults = Object.fromEntries(manifest.settings.flatMap((field) => field.default === undefined ? [] : [[field.key, field.default]]));
  // Values survive a version that removes or changes a field; reverting code must not discard the user's settings.
  return { ...defaults, ...values };
}

export async function importTool(store: ObjectStore, files: Files, { manifest, bytes }: ImportedTool): Promise<ApiResult<ToolImport>> {
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
    // Reset before the new code is visible; a failure can ask again but never grant a new capability silently. Each
    // answer is asked again only for a use it covers: a version that only adds the memory claim keeps 모델 호출.
    const added = manifest.uses.filter((use) => !existing.value.manifest.uses.includes(use));
    const answers = [...(added.includes('model') || added.includes('embed') ? ['botModels' as const] : []), ...(added.includes('memory') ? ['takesMemory' as const] : [])];
    if (answers.length) {
      const reset = await store.update('module', id, (current) => current.deleted === undefined ? answers.reduce((module, answer) => without(module, answer), current) : null);
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

export async function setToolSettings({ store }: Pick<Session, 'store'>, module: string, change: Settings): Promise<ApiResult<unknown>> {
  return store.update('tool', toolId(module), (current) => live(store.get('module', module)) ? { ...current, settings: { ...current.settings, ...Object.fromEntries(current.manifest.settings.flatMap((field) => Object.hasOwn(change, field.key) && fieldValue(field, change[field.key]) ? [[field.key, change[field.key]!]] : [])) } } : null);
}

async function keyId(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const hex = [...digest.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Every device addresses the same key. The module separates equal key names owned by different tools; a chat's badge
// record has one part fewer, so no key a tool names reaches its id.
export const toolDataId = (module: string, key: string) => keyId(`${module}\0${key}`);
export const toolChatId = (module: string, chat: string, key: string | null) => keyId(key === null ? `${module}\0${chat}` : `${module}\0${chat}\0${key}`);

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

const chatRows = (store: ObjectStore, module: string, chat: string) => store.children('toolchat', chat).filter(({ value }) => value.module === module);
export const toolChatData = (store: ObjectStore, module: string, chat: string, key: string): Json | undefined => chatRows(store, module, chat).find(({ value }) => value.key === key)?.value.value;
export const toolChatKeys = (store: ObjectStore, module: string, chat: string): string[] => chatRows(store, module, chat).flatMap(({ value }) => (value.key === null ? [] : [value.key]));
export const toolBadges = (store: ObjectStore, module: string, chat: string): Badges => (chatRows(store, module, chat).find(({ value }) => value.key === null)?.value.value ?? {}) as Badges;

// One event's data for one chat, and its badges by message, null clearing one, as one batch: a tool indexing a long
// chat key by key spends one write of its rate, not one per key.
export async function saveToolChat(store: ObjectStore, module: string, chat: string, data: [string, Json | undefined][], badges: { message: string; version: string; text: string | null }[]): Promise<ApiResult<null>> {
  if (!live(store.get('module', module))) return { ok: false, error: 'gone' };
  const existing = chatRows(store, module, chat);
  const stored = new Map(existing.map((row) => [row.value.key, row.id]));
  const rows = new Map(existing.map((row) => [row.value.key, row.value.value]));
  const changed = new Map<string | null, Json | undefined>(data);
  if (data.some(([key]) => key.length > TOOL_KEY_CHARS)) return { ok: false, error: 'key-too-long' };
  if (data.some(([key, value]) => value !== undefined && dataBytes(key, value) > TOOL_VALUE_BYTES)) return { ok: false, error: 'too-large' };
  if (badges.length) {
    const held: Badges = { ...(rows.get(null) as Badges | undefined) };
    for (const { message, version, text } of badges) {
      if (text === null) delete held[message];
      else held[message] = { version, text };
    }
    changed.set(null, Object.keys(held).length ? held : undefined);
  }
  for (const [key, value] of changed) {
    if (value === undefined) rows.delete(key);
    else rows.set(key, value);
  }
  if ([...rows].reduce((sum, [key, value]) => sum + dataBytes(key ?? '', value), 0) > TOOL_CHAT_BYTES) return { ok: false, error: 'too-large' };
  const writes: Write[] = [];
  for (const [key, value] of changed) {
    const id = await toolChatId(module, chat, key);
    // restore writes over a held or deleted row alike, and creates one never written.
    if (value !== undefined) writes.push({ type: 'restore', kind: 'toolchat', id, parent: chat, value: { module, key, value } });
    else if (stored.has(key)) writes.push({ type: 'remove', id: stored.get(key)! });
  }
  return writes.length ? store.batch(writes) : { ok: true, data: null };
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
