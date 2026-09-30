import type { Assignment } from '../connectors/assignment';
import type { TranslateSwitches } from './chat';
import type { ToggleValues } from './prompt';

// One settings object per account, at a fixed id, so two devices that create it at once meet in a
// version conflict instead of making two.
export const SETTINGS_ID = '00000000-0000-4000-8000-000000000000';

// models: the 기본값 layer of the model assignment. prompt: the default prompt, absent only until the starter
// prompt is added; translatePrompt the default translation prompt, likewise. persona: the default persona, absent for
// none. toggles and translate: those of 캐릭터 없이's chats. profile: the default 설정 묶음, absent only until the
// first is added.
export type Settings = {
  models: Assignment;
  prompt?: string;
  translatePrompt?: string;
  persona?: string;
  toggles?: ToggleValues;
  translate?: TranslateSwitches;
  profile?: string;
};
