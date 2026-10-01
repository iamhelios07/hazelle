import type { Card, Imported, RisuCharacter, RisuChat, RisuPersona, RisuPreset } from '../engine/import/types';
import type { Chat } from '../model/chat';
import type { MemorySettings } from '../model/memory';
import type { ApiResult } from './api';
import { createFolder, importCharacter, saveAssets } from './characters';
import { chatWrites } from './chat-log';
import type { Files } from './files';
import { defaultMemory } from './memory';
import { addPersona } from './personas';
import { thumbnail } from './picture';
import { savePreset } from './prompts';
import type { ObjectStore, Write } from './store';

export type MovePick = { characters: RisuCharacter[]; personas: RisuPersona[]; presets: RisuPreset[] };
export type MoveStep = { kind: 'characters' | 'chats' | 'personas' | 'prompts'; done: number; total: number };
// risu: its Risu chaId. skipped as in runtime/characters ImportedCharacter; faceless also when the picture did not read.
export type MovedCharacter = { id: string; risu: string; name: string; chats: number; skipped: number; faceless: boolean };
export type Moved = { characters: MovedCharacter[]; personas: number; prompts: number };

// Those in 지운 캐릭터 too, until they are removed for good.
export const broughtFromRisu = (store: ObjectStore): Set<string> => new Set(store.list('character').flatMap(({ value }) => (value.risu === undefined ? [] : [value.risu])));

// Personas first, so the chats bound to one use it. The first failure stops the rest, and what was saved before it
// stays. A character already brought is skipped, which is sound because each one lands whole: its chats go in its own
// batch (runtime/characters addCharacter).
export async function moveFromRisu(store: ObjectStore, files: Files, { characters, personas, presets }: MovePick, progress: (step: MoveStep) => void): Promise<ApiResult<Moved>> {
  const personaIds = new Map<string, string>();
  for (const [done, persona] of personas.entries()) {
    progress({ kind: 'personas', done, total: personas.length });
    const picture = await persona.picture();
    const thumb = picture && (await thumbnail(picture).catch(() => null));
    const saved = await addPersona(store, { name: persona.name, description: persona.description, picture: thumb });
    if (!saved.ok) return saved;
    if (persona.id !== null) personaIds.set(persona.id, saved.data.id);
  }

  let prompts = 0;
  for (const [done, { result }] of presets.entries()) {
    progress({ kind: 'prompts', done, total: presets.length });
    const saved = await savePreset(store, result);
    if (saved.ok) prompts++;
    else if (saved.failure.kind === 'save') return saved.failure.failure;
  }

  const brought = broughtFromRisu(store);
  const due = characters.filter(({ id }) => !brought.has(id));
  const chatTotal = due.reduce((sum, { chats }) => sum + chats.length, 0);
  let chatsDone = 0;
  const moved: MovedCharacter[] = [];
  for (const [done, character] of due.entries()) {
    progress({ kind: 'characters', done, total: due.length });
    const folder = character.folder === null ? null : await folderNamed(store, character.folder);
    if (folder && !folder.ok) return folder;
    const avatar = await character.avatar();
    const thumb = avatar && (await thumbnail(avatar).catch(() => null));
    const id = crypto.randomUUID();
    // Moved chats start with long-term memory off: on, opening a long one would summarize its whole past at once (user,
    // 2026-10-01: 옮겨 온 대화는 꺼진 채로). Turning it on in the chat summarizes it then.
    const memory = { ...defaultMemory(store), on: false };
    const chats = character.chats.flatMap((chat) => chatOf(id, character.card, chat, personaIds, memory));
    const saved = await importCharacter(store, files, character, avatar && thumb ? { ...avatar, thumb } : null, () => {}, { id, folder: folder?.data ?? null, risu: character.id, chats });
    if (!saved.ok) return saved;
    chatsDone += character.chats.length;
    progress({ kind: 'chats', done: chatsDone, total: chatTotal });
    const { skipped, faceless } = saved.data;
    moved.push({ id, risu: character.id, name: character.card.name, chats: character.chats.length, skipped, faceless: faceless || (avatar !== null && thumb === null) });
  }
  return { ok: true, data: { characters: moved, personas: personas.length, prompts } };
}

async function folderNamed(store: ObjectStore, name: string): Promise<ApiResult<string>> {
  const held = store.list('folder').find(({ value }) => value.parent === undefined && value.name === name);
  if (held) return { ok: true, data: held.id };
  const made = await createFolder(store, name, null);
  return made.ok ? { ok: true, data: made.data.id } : made;
}

// The chat opens on the greeting Risu showed, among the card's greetings that are not blank as a new chat's does
// (runtime/turn greetingOf); a blank one shown leaves the chat without one, as Risu showed none.
function chatOf(character: string, card: Card, { title, note, persona, greeting, variables, messages }: RisuChat, personaIds: ReadonlyMap<string, string>, memory: MemorySettings): Write[] {
  const shown = card.greetings.flatMap((text, index) => (text.trim() ? [index] : []));
  const selected = shown.indexOf(greeting);
  const greetings = selected === -1 ? null : { ids: shown.map(() => crypto.randomUUID()), texts: shown.map((index) => card.greetings[index]!), selected, translations: new Map() };
  const own = persona === null ? undefined : personaIds.get(persona);
  const chat: Chat = { title: title.trim() || null, character, models: {}, memory, ...(note !== null && { note }), ...(own && { persona: own }), ...(variables.length > 0 && { variables }) };
  return chatWrites(crypto.randomUUID(), chat, greetings, messages);
}

export const risuMatch = (store: ObjectStore, name: string): string | null =>
  store.list('character').find(({ value }) => value.risu !== undefined && value.deleted === undefined && value.card.name === name)?.id ?? null;

// Only the names the character does not have yet; skipped as in runtime/characters ImportedCharacter, so a name it
// had is neither kept nor skipped.
export async function fillPictures(store: ObjectStore, files: Files, character: string, assets: Imported['assets']): Promise<ApiResult<{ kept: number; skipped: number }>> {
  if (!store.get('character', character)) return { ok: false, error: 'gone' };
  const had = new Set(store.children('asset', character).map(({ value }) => value.name));
  const saved = await saveAssets(files, assets.filter(({ name }) => !had.has(name)), () => {});
  if (!saved.ok) return saved;
  const { kept, skipped } = saved.data;
  const added = await store.batch(kept.map((value): Write => ({ type: 'create', kind: 'asset', id: crypto.randomUUID(), parent: character, value })));
  return added.ok ? { ok: true, data: { kept: kept.length, skipped } } : added;
}
