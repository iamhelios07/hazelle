import type { BackupCatalog, Card, Imported, ImportReport, MoveUnsupported, RisuBackup, RisuChat } from '../engine/import/types';
import { unused, type Unused } from '../engine/pipeline';
import type { Chat } from '../model/chat';
import type { MemorySettings } from '../model/memory';
import type { ApiFailure, ApiResult } from './api';
import { createFolder, importCharacter, saveAssets, type Progress } from './characters';
import { chatWrites } from './chat-log';
import type { Files } from './files';
import { projectGreetings, startingGreetings } from './greetings';
import { defaultMemory } from './memory';
import { importModule, setModuleAlways } from './modules';
import { addPersona } from './personas';
import { thumbnail } from './picture';
import { savePreset } from './prompts';
import type { ObjectStore, Write } from './store';

export type MovePick = Pick<BackupCatalog, 'characters' | 'personas' | 'presets' | 'modules'>;
// pictures counts every picture the pick holds, across its modules and characters, as they go up.
export type MoveStep = { kind: 'characters' | 'chats' | 'personas' | 'prompts' | 'modules' | 'pictures'; done: number; total: number };
// risu: its Risu chaId. skipped as in runtime/characters ImportedCharacter; faceless also when the picture did not read.
export type MovedCharacter = { id: string; risu: string; name: string; chats: number; skipped: number; faceless: boolean; report: ImportReport; missed: MoveUnsupported[]; unused: Unused[] };
// skipped: its pictures that were not kept.
export type MovedModule = { name: string; unsupported: ImportReport['unsupported']; skipped: number };
export type Moved = { characters: MovedCharacter[]; personas: number; prompts: number; modules: MovedModule[] };

// Those in 휴지통 too, until they are removed for good.
export const broughtFromRisu = (store: ObjectStore): Set<string> => new Set(store.list('character').flatMap(({ value }) => (value.risu === undefined ? [] : [value.risu])));

// By Risu id, the deleted ones too, until they are removed for good.
export const modulesFromRisu = (store: ObjectStore): Map<string, string> => new Map(store.list('module').flatMap(({ id, value }) => (value.risu === undefined ? [] : [[value.risu, id]])));

// Personas first, so the chats bound to one use it, and modules before the characters they are on for. The first
// failure stops the rest, and what was saved before it stays. A character already brought is skipped, which is sound
// because each one lands whole: all chats are staged before runtime/characters publishes the character. So is a module: its
// 항상 is written before it, under the id it is then saved at, so a move cut between the two leaves only an id that
// names nothing, which reads as off, and the next run brings the module again. Every write is of the timeline the move
// began on: an account restored meanwhile stops it.
export function moveFromRisu(store: ObjectStore, files: Files, backup: RisuBackup, pick: MovePick, progress: (step: MoveStep) => void): Promise<ApiResult<Moved>> {
  return store.pinned(() => move(store, files, backup, pick, progress));
}

async function move(store: ObjectStore, files: Files, backup: RisuBackup, { characters, personas, presets, modules }: MovePick, progress: (step: MoveStep) => void): Promise<ApiResult<Moved>> {
  const personaIds = new Map<string, string>();
  for (const [done, { key }] of personas.entries()) {
    progress({ kind: 'personas', done, total: personas.length });
    const persona = await backup.persona(key);
    const picture = await persona.picture();
    const thumb = picture && (await thumbnail(picture).catch(() => null));
    const saved = await addPersona(store, { name: persona.name, description: persona.description, picture: thumb, ...(persona.alias && { alias: persona.alias }) });
    if (!saved.ok) return saved;
    if (persona.id !== null) personaIds.set(persona.id, saved.data.id);
  }

  let prompts = 0;
  for (const [done, { key }] of presets.entries()) {
    progress({ kind: 'prompts', done, total: presets.length });
    const { result } = await backup.preset(key);
    const saved = await savePreset(store, result);
    if (saved.ok) prompts++;
    else if (saved.failure.kind === 'save') return saved.failure.failure;
  }

  const moduleIds = modulesFromRisu(store);
  const dueModules = modules.filter(({ risu }) => risu === null || !moduleIds.has(risu));
  const brought = broughtFromRisu(store);
  const due = characters.filter(({ id }) => !brought.has(id)).sort((a, b) => a.lastTalk - b.lastTalk);
  const pictureTotal = [...dueModules, ...due].reduce((sum, { assetCount }) => sum + assetCount, 0);
  let picturesDone = 0;
  // Uploading pictures is the long part of a move, so each window of them is reported over the whole pick.
  const uploading: Progress = (step) => {
    if (step.kind === 'assets') progress({ kind: 'pictures', done: picturesDone + step.done, total: pictureTotal });
  };
  const movedModules: MovedModule[] = [];
  for (const [done, { key }] of dueModules.entries()) {
    progress({ kind: 'modules', done, total: dueModules.length });
    const module = await backup.module(key);
    const id = crypto.randomUUID();
    // Only one this run brings: one already here keeps the 항상 the user has since given it.
    if (module.risu !== null && backup.catalog.alwaysModules.includes(module.risu)) {
      const always = await setModuleAlways(store, id, true);
      if (!always.ok) return always;
    }
    const saved = await importModule(store, files, module, uploading, module.risu === null ? undefined : { id, risu: module.risu });
    if (!saved.ok) return saved;
    picturesDone += module.assets.length;
    movedModules.push({ name: module.name, unsupported: module.unsupported, skipped: saved.data.skipped });
    if (module.risu !== null) moduleIds.set(module.risu, saved.data.id);
  }

  // Chats and characters are listed by the server's rev, the latest first, and a batch takes its revs in the order
  // written. So what was talked in last is written last, whatever order Risu kept it in (due).
  const chatTotal = due.reduce((sum, { chatCount }) => sum + chatCount, 0);
  let chatsDone = 0;
  const moved: MovedCharacter[] = [];
  for (const [done, { key }] of due.entries()) {
    progress({ kind: 'characters', done, total: due.length });
    const character = await backup.character(key);
    const folder = character.folder === null ? null : await folderNamed(store, character.folder);
    if (folder && !folder.ok) return folder;
    const avatar = await character.avatar();
    const id = crypto.randomUUID();
    // Moved chats start with long-term memory off: on, opening a long one would summarize its whole past at once (user,
    // 2026-10-01: 옮겨 온 대화는 꺼진 채로). Turning it on in the chat summarizes it then.
    const memory = { ...defaultMemory(store), on: false };
    const chats: string[] = [];
    for (const chat of [...character.chats].sort((a, b) => lastTalk(a) - lastTalk(b))) {
      const chatId = crypto.randomUUID();
      const failure = await stageChat(store, chatOf(chatId, id, character.card, chat, personaIds, memory));
      if (failure) return failure;
      chats.push(chatId);
      progress({ kind: 'chats', done: ++chatsDone, total: chatTotal });
    }
    const saved = await importCharacter(store, files, character, avatar, uploading, { id, folder: folder?.data ?? null, risu: character.id, modules: character.modules.flatMap((risu) => moduleIds.get(risu) ?? []) });
    if (!saved.ok) return saved;
    // Canonical summaries read the published card and its actual revision; only primary objects precede publication.
    const summarized = await store.saveSummaries(chats);
    if (summarized) return summarized;
    picturesDone += character.assets.length;
    const { skipped, faceless } = saved.data;
    moved.push({ id, risu: character.id, name: character.card.name, chats: character.chats.length, skipped, faceless, report: character.report, missed: character.missed, unused: unused(character.card) });
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

function chatOf(id: string, character: string, card: Card, { title, note, persona, greeting, variables, messages }: RisuChat, personaIds: ReadonlyMap<string, string>, memory: MemorySettings): Iterable<Write> {
  // The chat opens on the greeting Risu showed; a blank one shown leaves the chat without one, as Risu showed none.
  const greetings = startingGreetings(projectGreetings(card.greetings, card.greetings.map(() => crypto.randomUUID()), greeting));
  const own = persona === null ? undefined : personaIds.get(persona);
  const chat: Chat = { title: title.trim() || null, character, models: {}, memory, ...(note !== null && { note }), ...(own && { persona: own }), ...(variables.length > 0 && { variables }) };
  return chatWrites(id, chat, greetings, messages);
}

async function stageChat(store: ObjectStore, writes: Iterable<Write>): Promise<ApiFailure | null> {
  let window: Write[] = [];
  for (const write of writes) {
    window.push(write);
    if (window.length < 128) continue;
    const saved = await store.batch(window, undefined, { unheld: true });
    if (!saved.ok) return saved;
    window = [];
  }
  if (!window.length) return null;
  const saved = await store.batch(window, undefined, { unheld: true });
  return saved.ok ? null : saved;
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
