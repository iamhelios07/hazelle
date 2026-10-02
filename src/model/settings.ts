import type { Assignment } from '../connectors/assignment';
import type { TranslateSwitches } from './chat';
import type { MemorySettings } from './memory';
import type { ToggleValues } from './prompt';

// One settings object per account, at a fixed id, so two devices that create it at once meet in a
// version conflict instead of making two.
export const SETTINGS_ID = '00000000-0000-4000-8000-000000000000';

// models: the 기본값 layer of the model assignment. prompt: the default prompt, absent only until the starter
// prompt is added; translatePrompt the default translation prompt and memoryPrompt the default memory prompt, likewise. persona: the default persona, absent for
// none. toggles and translate: those of 캐릭터 없이's chats. profile: the default 설정 묶음, absent only until the
// first is added. memory: every chat's memory settings, absent fields read through runtime/memory memorySetup.
// modules: the modules on in every chat (항상), in the order they were turned on (design §6.5).
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
};
