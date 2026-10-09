import { live, type PackOwner } from '../../model/library';
import type { ObjectStore } from '../../runtime/store';
import { aliased } from './alias';

export function scriptVoice(store: ObjectStore, owner: PackOwner | null): { name: string; face: string | null } | null {
  if (!owner) return null;
  if (owner.kind === 'module') {
    const module = live(store.get('module', owner.id));
    return module && { name: module.value.name, face: null };
  }
  const character = live(store.get('character', owner.id));
  return character && { name: aliased(character.value.card.name, character.value.alias), face: store.children('avatar', owner.id)[0]?.value.thumb ?? null };
}
