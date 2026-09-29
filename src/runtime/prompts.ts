import { importPreset, type PresetFailure, type PresetUnsupported } from '../engine/import/preset';
import type { Chat } from '../model/chat';
import type { Stored } from '../model/kinds';
import type { Block, Prompt } from '../model/prompt';
import { SETTINGS_ID } from '../model/settings';
import { fromBase64 } from '../vault/aead';
import type { ApiFailure, ApiResult } from './api';
import type { ObjectStore } from './store';

// Every write of `prompt` objects and of the default prompt, except a prompt's `models` layer, which
// runtime/assignment writes with the other layers, and a backup's restore (runtime/backup).

// Fixed, so two devices adding the starter prompt at once meet in a version conflict instead of making two.
export const STARTER_ID = '00000000-0000-4000-8000-000000000001';

// Which prompt a chat uses: its own, else the default (design §4.2). A deleted one, or a default not added
// yet, reads as missing and never as another prompt; a turn stops on it ("기본 프롬프트가 없어요").
export type PromptChoice = { kind: 'prompt'; prompt: Stored<'prompt'>; own: boolean } | { kind: 'missing'; own: boolean };

export function chatPrompt(store: ObjectStore, chat: Chat): PromptChoice {
  const own = chat.prompt !== undefined;
  const id = chat.prompt ?? store.get('settings', SETTINGS_ID)?.value.prompt;
  const prompt = id === undefined ? null : store.get('prompt', id);
  return prompt ? { kind: 'prompt', prompt, own } : { kind: 'missing', own };
}

// A new prompt holds every slot once, the context before the chat and the notes after it, and the two texts
// a card replaces, empty, so a card's system prompt and post-history instructions have their places.
export function addPrompt(store: ObjectStore, name: string): Promise<ApiResult<Stored<'prompt'>>> {
  const named = () => ({ id: crypto.randomUUID(), name: null });
  const blocks: Block[] = [
    { ...named(), kind: 'text', role: 'system', text: '', mark: 'main' },
    { ...named(), kind: 'slot', slot: 'description', role: 'system', wrapper: null },
    { ...named(), kind: 'slot', slot: 'persona', role: 'system', wrapper: null },
    { ...named(), kind: 'slot', slot: 'lorebook' },
    { ...named(), kind: 'slot', slot: 'chat', range: { from: 0, to: null } },
    { ...named(), kind: 'text', role: 'system', text: '', mark: 'globalNote' },
    { ...named(), kind: 'slot', slot: 'authorNote', role: 'system', wrapper: null },
    { ...named(), kind: 'slot', slot: 'postEverything' },
  ];
  return store.create('prompt', { name, blocks, toggles: [], authorNote: '', models: {} });
}

export type ImportPromptResult = { ok: true; id: string; unsupported: PresetUnsupported[] } | { ok: false; failure: PresetFailure | { kind: 'save'; failure: ApiFailure } };

// A dropped .risup becomes a new prompt (design §5 Scope); unsupported is what the summary counts.
export async function importPrompt(store: ObjectStore, bytes: Uint8Array): Promise<ImportPromptResult> {
  const read = await importPreset(bytes);
  if (!read.ok) return read;
  const saved = await store.create('prompt', read.prompt);
  return saved.ok ? { ok: true, id: saved.data.id, unsupported: read.unsupported } : { ok: false, failure: { kind: 'save', failure: saved } };
}

// design §4.2: an account that has never had a default prompt gets the bundled starter prompt as its
// default, once. The session awaits it when it opens (runtime/session); a failure is tried again next time.
export async function addStarter(store: ObjectStore): Promise<void> {
  if (store.get('settings', SETTINGS_ID)?.value.prompt !== undefined) return;
  if (!store.get('prompt', STARTER_ID)) {
    const read = await importPreset(await starterBytes());
    if (!read.ok) return;
    const saved = await store.create('prompt', read.prompt, { id: STARTER_ID });
    if (!saved.ok) return;
  }
  await store.upsert('settings', (current) => (current?.prompt === undefined ? { models: {}, ...current, prompt: STARTER_ID } : current));
}

// Vite hands an ?inline asset over as a base64 data: URL, in the browser and in tests alike. It is decoded
// here rather than fetched: the CSP allows no data: requests.
async function starterBytes(): Promise<Uint8Array<ArrayBuffer>> {
  const { default: uri } = await import('./starter-prompt.risup?inline');
  return fromBase64(uri.slice(uri.indexOf(',') + 1));
}

// Only the fields given, merged into the current prompt, so an edit to another field on another device survives.
export type PromptPatch = Partial<Pick<Prompt, 'name' | 'blocks' | 'toggles' | 'authorNote'>>;

export const editPrompt = (store: ObjectStore, id: string, patch: PromptPatch) => store.update('prompt', id, (current) => ({ ...current, ...patch }));

// A fork that goes its own way (design §4.2), model layer and toggles included. It remembers its origin, and
// is the user's own rather than an imported preset.
export function copyPrompt(store: ObjectStore, id: string, name: string): Promise<ApiResult<Stored<'prompt'>>> {
  const original = store.get('prompt', id)?.value;
  if (!original) return Promise.resolve({ ok: false, error: 'gone' });
  const copy: Prompt = { ...original, name, origin: { id, name: original.name } };
  delete copy.imported;
  return store.create('prompt', copy);
}

// design §4.2: the default prompt cannot be deleted until another prompt is made the default.
export async function removePrompt(store: ObjectStore, id: string): Promise<ApiResult<Stored<'prompt'>> | { ok: false; error: 'default' }> {
  if (store.get('settings', SETTINGS_ID)?.value.prompt === id) return { ok: false, error: 'default' };
  const prompt = store.get('prompt', id);
  if (!prompt) return { ok: false, error: 'gone' };
  const removed = await store.remove(id);
  return removed.ok ? { ok: true, data: prompt } : removed;
}

export const restorePrompt = (store: ObjectStore, removed: Stored<'prompt'>) => store.restore(removed);

export const setDefaultPrompt = (store: ObjectStore, id: string) => store.upsert('settings', (current) => ({ models: {}, ...current, prompt: id }));
