import type { Assignment } from '../connectors/assignment';
import type { TranslateSwitches } from './chat';
import type { FeatureSwitches } from './features';
import type { IllustrateSwitches } from './illustration';
import type { MemorySettings } from './memory';
import type { ToggleValues } from './prompt';

// One settings object per account, at a fixed id, so two devices that create it at once meet in a
// version conflict instead of making two.
export const SETTINGS_ID = '00000000-0000-4000-8000-000000000000';
export const EMPTY_SETTINGS: Settings = { models: {} };

// The experiments running, each a switch on 설정 › 실험실 (app/common/labs LABS). Deleting an id breaks every reader of
// it at compile time.
export type LabId = 'preread';
export const labOn = (settings: Pick<Settings, 'labs'> | undefined, id: LabId) => settings?.labs?.includes(id) ?? false;

// What the 보조 model reads for 토큰 절약 (runtime/preread): which parts of the prompt, how many of the latest chat
// messages stay as written, and batch: how many o200k tokens of material no brief holds yet make a call worth it.
export type PrereadParts = { chat: boolean; system: boolean; lore: boolean };
export type PrereadSettings = { parts: PrereadParts; recent: number; batch: number };

// prompt: the default prompt, absent only until the starter prompt is added; translatePrompt the default translation
// prompt, memoryPrompt the default memory prompt, illustratePrompt the default 삽화 prompt, mascotPrompt the default 마스코트
// prompt and prereadPrompt the default 토큰 절약 prompt, likewise. persona: the default persona, absent for none. toggles:
// those of 캐릭터 없이's chats. translate: every chat's translation switches but those of a character with its own
// (Character.ownTranslate). illustrate: likewise every chat's 삽화
// switches (Character.ownIllustrate). profile: the default 설정 묶음, absent only until the first is added.
// memory: every chat's memory settings, absent fields read through runtime/memory memorySetup. modules: the modules
// on in every chat (항상), in the order they were turned on (design §6.5). translatorNote: 전역 번역가의 노트, sent in every
// character's translations together with the character's own (runtime/characters translatorNotes). importNotice: the
// RisuAI-only bot notice was confirmed, so imports no longer ask first (library/ImportFlow). ledger: how far the one fill
// of the ledger from the calls made before it went (runtime/usage fill), absent until it starts. looks: the account's
// own 디스플레이 presets in the user's order; a look's values are names the app reads (app/common/reading savedPresets).
// retries: the shared 실패하면 다시 보내기, absent for RETRIES; a connection or a 설정 묶음 overrides it (runtime/connections
// retriesOf). loreBudget: 로어북 최대 분량, the most tokens every chat's lorebook entries may take, absent for LORE_BUDGET
// (runtime/chat-context loreBudgetOf). labs: the 실험실 switches turned on, by entry id (LabId); an id with no entry
// is ignored. features: 기능, the ladder's farthest layer (runtime/features). answerInstruction: 응답 받기 지시,
// absent for ANSWER_INSTRUCTION (runtime/chat-context answerInstructionOf).
export type SavedLook = { id: string; name: string; look: Record<string, string | number> };

export type Settings = {
  models: Assignment;
  prompt?: string;
  translatePrompt?: string;
  memoryPrompt?: string;
  illustratePrompt?: string;
  mascotPrompt?: string;
  prereadPrompt?: string;
  persona?: string;
  toggles?: ToggleValues;
  // 입력창에 고정: toggle keys shown beside the composer of every chat whose prompt, card or modules declare them.
  pinnedToggles?: string[];
  translate?: TranslateSwitches;
  illustrate?: IllustrateSwitches;
  profile?: string;
  memory?: Partial<MemorySettings>;
  modules?: string[];
  translatorNote?: string;
  importNotice?: true;
  ledger?: 'filled' | { after: string };
  looks?: SavedLook[];
  retries?: number;
  loreBudget?: number;
  labs?: string[];
  features?: FeatureSwitches;
  // Its fields absent read through runtime/preread prereadSetup.
  preread?: Partial<PrereadSettings>;
  answerInstruction?: string;
  // 헤이젤 나우 (design §6.12): false stops every usage label this account's pages send; absent shares (the default).
  pulse?: false;
};
