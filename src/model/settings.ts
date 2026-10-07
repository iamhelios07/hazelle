import type { Assignment } from '../connectors/assignment';
import type { TranslateSwitches } from './chat';
import type { MemorySettings } from './memory';
import type { ToggleValues } from './prompt';

// One settings object per account, at a fixed id, so two devices that create it at once meet in a
// version conflict instead of making two.
export const SETTINGS_ID = '00000000-0000-4000-8000-000000000000';

// prompt: the default prompt, absent only until the starter prompt is added; translatePrompt the default translation
// prompt and memoryPrompt the default memory prompt, likewise. persona: the default persona, absent for none. toggles:
// those of 캐릭터 없이's chats. translate: every chat's translation switches but those of a character with its own
// (Character.ownTranslate). profile: the default 설정 묶음, absent only until the first is added.
// memory: every chat's memory settings, absent fields read through runtime/memory memorySetup. modules: the modules
// on in every chat (항상), in the order they were turned on (design §6.5). translatorNote: 전역 번역가의 노트, sent in every
// character's translations together with the character's own (runtime/characters translatorNotes). importNotice: the
// RisuAI-only bot notice was confirmed, so imports no longer ask first (library/ImportFlow).
export type Settings = {
  models: Assignment;
  prompt?: string;
  translatePrompt?: string;
  memoryPrompt?: string;
  persona?: string;
  toggles?: ToggleValues;
  translate?: TranslateSwitches;
  profile?: string;
  memory?: Partial<MemorySettings>;
  modules?: string[];
  translatorNote?: string;
  importNotice?: true;
};
