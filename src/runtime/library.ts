import { KEEP_DELETED, type Character, type Lore } from '../model/library';
import type { ApiResult } from './api';
import { getBlob, putBlob, removeBlob, type OpenVault } from './blobs';
import type { ObjectStore } from './store';

// The picture of a new character: the original goes to its sealed blob, the thumbnail into the avatar
// object beside it.
export type Picture = { bytes: Uint8Array<ArrayBuffer>; type: string; thumb: string };
export type Progress = (step: { kind: 'picture' } | { kind: 'lore'; saved: number; total: number }) => void;

// Lorebook entries are saved this many at a time: one request each, and bots carry hundreds.
const PARALLEL = 8;

// The character is saved last, so it shows up only once its picture and lorebook are in. A failure
// midway leaves pieces nothing points at, never a character missing some of its own.
export async function addCharacter(store: ObjectStore, vault: OpenVault, character: Character, lore: Lore[], picture: Picture | null, progress: Progress): Promise<ApiResult<string>> {
  const id = crypto.randomUUID();
  if (picture) {
    progress({ kind: 'picture' });
    const blob = crypto.randomUUID();
    const put = await putBlob(vault, blob, picture.bytes);
    if (!put.ok) return put;
    const saved = await store.create('avatar', { type: picture.type, size: picture.bytes.length, thumb: picture.thumb }, { id: blob, parent: id });
    if (!saved.ok) return saved;
  }
  for (let start = 0; start < lore.length; start += PARALLEL) {
    progress({ kind: 'lore', saved: start, total: lore.length });
    const saved = await Promise.all(lore.slice(start, start + PARALLEL).map((entry) => store.create('lore', entry, { parent: id })));
    const failure = saved.find((result) => !result.ok);
    if (failure && !failure.ok) return failure;
  }
  const saved = await store.create('character', character, { id });
  return saved.ok ? { ok: true, data: id } : saved;
}

// A copy that goes its own way (사본 만들기): the card under a new name, the lorebook and the picture,
// in the original's folder. Chats stay with the original. The picture is copied, not shared, because a
// blob is sealed to its own id.
export async function copyCharacter(store: ObjectStore, vault: OpenVault, id: string, name: string, progress: Progress): Promise<ApiResult<string>> {
  const original = store.get('character', id)?.value;
  if (!original) return { ok: false, error: 'gone' };
  const [avatar] = store.children('avatar', id);
  let picture: Picture | null = null;
  if (avatar) {
    const bytes = await getBlob(vault, avatar.id);
    if (!bytes.ok) return bytes;
    picture = { bytes: bytes.data, type: avatar.value.type, thumb: avatar.value.thumb };
  }
  const lore = store.children('lore', id).map((entry) => entry.value);
  return addCharacter(store, vault, { ...original, card: { ...original.card, name }, origin: { id, name: original.card.name } }, lore, picture, progress);
}

// Removes a character for good: its picture, lorebook, chats and their entries, and the character
// last, so a removal cut short is picked up again while the character is still there.
export async function purgeCharacter(store: ObjectStore, vault: OpenVault, id: string, progress: (removed: number, total: number) => void): Promise<ApiResult<null>> {
  const chats = store.list('chat').filter((chat) => chat.value.character === id).map((chat) => chat.id);
  const avatars = store.children('avatar', id);
  for (const avatar of avatars) {
    const removed = await removeBlob(vault, avatar.id);
    if (!removed.ok) return removed;
  }
  const entries = chats.flatMap((chat) => store.children('entry', chat));
  const lore = store.children('lore', id);
  // The chats go only after every entry, so a removal cut short still reaches the entries left.
  const rounds = [[...entries, ...lore, ...avatars].map((object) => object.id), chats];
  const total = rounds[0]!.length + rounds[1]!.length;
  let done = 0;
  for (const ids of rounds) {
    for (let start = 0; start < ids.length; start += PARALLEL) {
      progress(done, total);
      const batch = ids.slice(start, start + PARALLEL);
      const removed = await Promise.all(batch.map((object) => store.remove(object)));
      const failure = removed.find((result) => !result.ok);
      if (failure && !failure.ok) return failure;
      done += batch.length;
    }
  }
  return store.remove(id);
}

// Runs when the app opens, on whichever device opens first. One that fails is tried again next time.
export async function purgeExpired(store: ObjectStore, vault: OpenVault, now: number): Promise<void> {
  for (const { id, value } of store.list('character')) {
    if (value.deleted !== undefined && now - value.deleted >= KEEP_DELETED) await purgeCharacter(store, vault, id, () => {});
  }
}
