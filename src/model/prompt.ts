import type { Assignment, ModelRef } from '../connectors/assignment';
import type { Mark } from './library';

export type Role = 'system' | 'user' | 'assistant';

export type PromptSort = 'conversation' | 'translate' | 'memory' | 'illustrate';

// A feature that brings something new to the prompt adds a row. wrapped: the slot takes a role and a 감싸는 텍스트 with
// {{slot}} where its content goes.
export const SLOTS = {
  tool: { wrapped: true, repeats: false, sorts: ['conversation'] },
  description: { wrapped: true, repeats: false, sorts: ['conversation', 'translate', 'memory', 'illustrate'] },
  persona: { wrapped: true, repeats: false, sorts: ['conversation', 'translate', 'memory', 'illustrate'] },
  lorebook: { wrapped: false, repeats: false, sorts: ['conversation', 'translate', 'memory', 'illustrate'] },
  authorNote: { wrapped: true, repeats: false, sorts: ['conversation'] },
  postEverything: { wrapped: false, repeats: false, sorts: ['conversation'] },
  chat: { wrapped: false, repeats: true, sorts: ['conversation'] },
  note: { wrapped: true, repeats: false, sorts: ['translate'] },
  recent: { wrapped: true, repeats: false, sorts: ['translate', 'illustrate'] },
  // In a 삽화 task, the message's paragraphs, numbered (model/illustration paragraphsOf).
  source: { wrapped: true, repeats: false, sorts: ['translate', 'illustrate'] },
  // 장기 기억: in a conversation, the chat's memory as sent; in a memory task, the memory the new records follow.
  memory: { wrapped: true, repeats: false, sorts: ['conversation', 'memory'] },
  span: { wrapped: true, repeats: false, sorts: ['memory'] },
} as const satisfies Record<string, { wrapped: boolean; repeats: boolean; sorts: readonly PromptSort[] }>;
export type SlotKind = keyof typeof SLOTS;
type Wrapped = { [K in SlotKind]: (typeof SLOTS)[K]['wrapped'] extends true ? K : never }[SlotKind];

export const slotsOf = (sort: PromptSort) => (Object.keys(SLOTS) as SlotKind[]).filter((slot) => (SLOTS[slot].sorts as readonly PromptSort[]).includes(sort));

// Counted in chat messages: a negative number counts from the end, and to null runs to the end.
// Past chat is {from: 0, to: -1}; the last message is {from: -1, to: null}.
export type ChatRange = { from: number; to: number | null };

// cache: 여기까지 캐시, a cache point on the last message sent up to and including this block.
type Named = { id: string; name: string | null; cache?: true };
// mark: the text a card replaces, main by its system prompt and globalNote by its post-history
// instructions, with {{original}} in the card's text standing for this block's text.
export type TextBlock = Named & { kind: 'text'; role: Role; text: string; mark: 'main' | 'globalNote' | null };
type WrappedFields = Named & { kind: 'slot'; role: Role; wrapper: string | null };
// count: how many messages before the source it holds. translations: false holds their originals only; absent holds
// each with its translation.
export type RecentSlot = WrappedFields & { slot: 'recent'; count: number; translations?: false };
export type WrappedSlot = (WrappedFields & { slot: Exclude<Wrapped, 'recent'> }) | RecentSlot;
export type ChatSlot = Named & { kind: 'slot'; slot: 'chat'; range: ChatRange };
export type PlainSlot = Named & { kind: 'slot'; slot: Exclude<SlotKind, Wrapped | 'chat'> };
export type Block = TextBlock | WrappedSlot | ChatSlot | PlainSlot;

// key is what conditions name ({{#when::toggle::key}}, toggle_key); label is what screens show. Values are
// strings because CBS reads them: a check is '1' or '0', a choice is its option's index.
export type Toggle = { key: string; label: string } & ({ kind: 'check'; default: '0' | '1' } | { kind: 'choice'; options: string[]; default: string });

// A character's or 캐릭터 없이's toggle values by key, over the declared defaults.
export type ToggleValues = Record<string, string>;

// authorNote is the default 작가의 노트, which a chat's own note replaces.
// origin is a copy's original, named as it was then. imported marks a prompt made from a Risu preset; a copy
// does not inherit it.
export type ConversationPrompt = {
  task?: never;
  name: string;
  blocks: Block[];
  toggles: Toggle[];
  authorNote: string;
  models: Assignment;
  origin?: { id: string; name: string };
  imported?: 'risu-preset';
  // The modules on in its chats, in the order they were turned on (design §6.5). One that is gone reads as off.
  modules?: string[];
};

// model: the one place a translation's model is chosen; without one, the chat's 보조 모델. Its text blocks carry no mark,
// since a card never replaces a translator's text.
export type TranslatePrompt = {
  task: 'translate';
  name: string;
  model?: ModelRef;
  blocks: Block[];
  toggles: Toggle[];
  origin?: { id: string; name: string };
};

// model: the one place the memory's model is chosen; without one, the chat's 보조 모델, then its 대화 모델.
export type MemoryPrompt = {
  task: 'memory';
  name: string;
  model?: ModelRef;
  blocks: Block[];
  toggles: Toggle[];
  origin?: { id: string; name: string };
};

// Danbooru-style tags, comma separated, put into every picture the prompt makes (engine/illustrate pictureRequest).
export type PictureTags = { artist: string; quality: string; negative: string };

// How each picture is drawn, a field absent for the image model's own (connectors PictureRequest), seed absent for a
// new one each picture.
export type PictureSettings = { steps?: number; scale?: number; rescale?: number; sampler?: string; seed?: number };

// model: the one place the scene writer is chosen; without one, the chat's 보조 모델, then its 대화 모델. The picture's
// model is the chat's 삽화 switches' (runtime/characters illustrateSwitches). tags: absent reads as the app's
// (engine/illustrate PICTURE_DEFAULTS); an empty field sends none.
export type IllustratePrompt = {
  task: 'illustrate';
  name: string;
  model?: ModelRef;
  tags?: PictureTags;
  picture?: PictureSettings;
  blocks: Block[];
  toggles: Toggle[];
  origin?: { id: string; name: string };
};

export type Prompt = (ConversationPrompt | TranslatePrompt | MemoryPrompt | IllustratePrompt) & Mark;
export type PromptOf<S extends PromptSort> = { conversation: ConversationPrompt; translate: TranslatePrompt; memory: MemoryPrompt; illustrate: IllustratePrompt }[S];

export const sortOf = (prompt: Prompt): PromptSort => prompt.task ?? 'conversation';
