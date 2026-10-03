import type { Card, Imported, ImportedModule, RisuCharacter, RisuChat, RisuPersona, RisuPreset } from '../engine/import/types';
import type { Chat } from '../model/chat';
import type { MemorySettings } from '../model/memory';
import type { ApiResult } from './api';
import { createFolder, importCharacter, saveAssets, type Progress } from './characters';
import { chatWrites } from './chat-log';
import type { Files } from './files';
import { defaultMemory } from './memory';
import { importModule, setModuleAlways } from './modules';
import { addPersona } from './personas';
import { thumbnail } from './picture';
import { savePreset } from './prompts';
import type { ObjectStore, Write } from './store';

// alwaysModules: the Risu ids of the modules Risu had on in every chat.
export type MovePick = { characters: RisuCharacter[]; personas: RisuPersona[]; presets: RisuPreset[]; modules: ImportedModule[]; alwaysModules: string[] };
// pictures counts every picture the pick holds, across its modules and characters, as they go up.
export type MoveStep = { kind: 'characters' | 'chats' | 'personas' | 'prompts' | 'modules' | 'pictures'; done: number; total: number };
// risu: its Risu chaId. skipped as in runtime/characters ImportedCharacter; faceless also when the picture did not read.
export type MovedCharacter = { id: string; risu: string; name: string; chats: number; skipped: number; faceless: boolean };
// skipped: its pictures that were not kept.
export type MovedModule = { module: ImportedModule; skipped: number };
export type Moved = { characters: MovedCharacter[]; personas: number; prompts: number; modules: MovedModule[] };

// Those in 휴지통 too, until they are removed for good.
export const broughtFromRisu = (store: ObjectStore): Set<string> => new Set(store.list('character').flatMap(({ value }) => (value.risu === undefined ? [] : [value.risu])));

// By Risu id, the deleted ones too, until they are removed for good.
export const modulesFromRisu = (store: ObjectStore): Map<string, string> => new Map(store.list('module').flatMap(({ id, value }) => (value.risu === undefined ? [] : [[value.risu, id]])));

// Personas first, so the chats bound to one use it, and modules before the characters they are on for. The first
// failure stops the rest, and what was saved before it stays. A character already brought is skipped, which is sound
// because each one lands whole: its chats go in its own batch (runtime/characters addCharacter). So is a module: its
// 항상 is written before it, under the id it is then saved at, so a move cut between the two leaves only an id that
// names nothing, which reads as off, and the next run brings the module again. Every write is of the timeline the move
// began on: an account restored meanwhile stops it.
export function moveFromRisu(store: ObjectStore, files: Files, pick: MovePick, progress: (step: MoveStep) => void): Promise<ApiResult<Moved>> {
  return store.pinned(() => move(store, files, pick, progress));
}

async function move(store: ObjectStore, files: Files, { characters, personas, presets, modules, alwaysModules }: MovePick, progress: (step: MoveStep) => void): Promise<ApiResult<Moved>> {
  const personaIds = new Map<string, string>();
  for (const [done, persona] of personas.entries()) {
    progress({ kind: 'personas', done, total: personas.length });
    const picture = await persona.picture();
    const thumb = picture && (await thumbnail(picture).catch(() => null));
    const saved = await addPersona(store, { name: persona.name, description: persona.description, picture: thumb, ...(persona.alias && { alias: persona.alias }) });
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

  const moduleIds = modulesFromRisu(store);
  const dueModules = modules.filter(({ risu }) => risu === null || !moduleIds.has(risu));
  const brought = broughtFromRisu(store);
  const due = characters.filter(({ id }) => !brought.has(id)).sort((a, b) => Math.max(0, ...a.chats.map(lastTalk)) - Math.max(0, ...b.chats.map(lastTalk)));
  const pictureTotal = [...dueModules, ...due].reduce((sum, { assets }) => sum + assets.length, 0);
  let picturesDone = 0;
  // Uploading pictures is the long part of a move, so each window of them is reported over the whole pick.
  const uploading: Progress = (step) => {
    if (step.kind === 'assets') progress({ kind: 'pictures', done: picturesDone + step.done, total: pictureTotal });
  };
  const movedModules: MovedModule[] = [];
  for (const [done, module] of dueModules.entries()) {
    progress({ kind: 'modules', done, total: dueModules.length });
    const id = crypto.randomUUID();
    // Only one this run brings: one already here keeps the 항상 the user has since given it.
    if (module.risu !== null && alwaysModules.includes(module.risu)) {
      const always = await setModuleAlways(store, id, true);
      if (!always.ok) return always;
    }
    const saved = await importModule(store, files, module, uploading, module.risu === null ? undefined : { id, risu: module.risu });
    if (!saved.ok) return saved;
    picturesDone += module.assets.length;
    movedModules.push({ module, skipped: saved.data.skipped });
    if (module.risu !== null) moduleIds.set(module.risu, saved.data.id);
  }

  // Chats and characters are listed by the server's rev, the latest first, and a batch takes its revs in the order
  // written. So what was talked in last is written last, whatever order Risu kept it in (due).
  const chatTotal = due.reduce((sum, { chats }) => sum + chats.length, 0);
  let chatsDone = 0;
  const moved: MovedCharacter[] = [];
  for (const [done, character] of due.entries()) {
    progress({ kind: 'characters', done, total: due.length });
    const folder = character.folder === null ? null : await folderNamed(store, character.folder);
    if (folder && !folder.ok) return folder;
    const avatar = await character.avatar();
    const id = crypto.randomUUID();
    // Moved chats start with long-term memory off: on, opening a long one would summarize its whole past at once (user,
    // 2026-10-01: 옮겨 온 대화는 꺼진 채로). Turning it on in the chat summarizes it then.
    const memory = { ...defaultMemory(store), on: false };
    const chats = [...character.chats].sort((a, b) => lastTalk(a) - lastTalk(b)).flatMap((chat) => chatOf(id, character.card, chat, personaIds, memory));
    const saved = await importCharacter(store, files, character, avatar, uploading, { id, folder: folder?.data ?? null, risu: character.id, modules: character.modules.flatMap((risu) => moduleIds.get(risu) ?? []), chats });
    if (!saved.ok) return saved;
    picturesDone += character.assets.length;
    chatsDone += character.chats.length;
    progress({ kind: 'chats', done: chatsDone, total: chatTotal });
    const { skipped, faceless } = saved.data;
    moved.push({ id, risu: character.id, name: character.card.name, chats: character.chats.length, skipped, faceless });
  }
  return { ok: true, data: { characters: moved, personas: personas.length, prompts, modules: movedModules } };
}

const lastTalk = (chat: RisuChat) => chat.messages.at(-1)?.at ?? 0;

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
