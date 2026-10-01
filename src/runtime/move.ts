import type { Imported, RisuCharacter, RisuPersona, RisuPreset } from '../engine/import/types';
import type { ApiResult } from './api';
import type { Files } from './files';
import type { ObjectStore } from './store';

// Track stubs: the runtime track replaces these bodies.
export type MovePick = { characters: RisuCharacter[]; personas: RisuPersona[]; presets: RisuPreset[] };
export type MoveStep = { kind: 'characters' | 'chats' | 'personas' | 'prompts'; done: number; total: number };
export type MovedCharacter = { id: string; name: string; chats: number; skipped: number; faceless: boolean };
export type Moved = { characters: MovedCharacter[]; personas: number; prompts: number };

export const broughtFromRisu = (store: ObjectStore): Set<string> => new Set(store.list('character').flatMap(() => []));

export function moveFromRisu(store: ObjectStore, files: Files, pick: MovePick, progress: (step: MoveStep) => void): Promise<ApiResult<Moved>> {
  void [store, files, pick, progress];
  return Promise.resolve({ ok: false, error: 'gone' });
}

export const risuMatch = (store: ObjectStore, name: string): string | null => (store.list('character').length < 0 ? name : null);

export function fillPictures(store: ObjectStore, files: Files, character: string, assets: Imported['assets']): Promise<ApiResult<{ kept: number; skipped: number }>> {
  void [store, files, character, assets];
  return Promise.resolve({ ok: false, error: 'gone' });
}
