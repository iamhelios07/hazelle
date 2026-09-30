import type { Assignment } from '../connectors/assignment';

export type Role = 'system' | 'user' | 'assistant';

// A conversation prompt, or a task prompt (design §4.2) named by its task.
export type PromptSort = 'conversation' | 'translate';

// The slot kinds: a feature that brings something new to the prompt adds a row.
// wrapped: the slot takes a role and a 감싸는 글 with {{slot}} where its content goes. repeats: it may
// be placed more than once. sorts: the prompts that may hold it.
export const SLOTS = {
  description: { wrapped: true, repeats: false, sorts: ['conversation', 'translate'] },
  persona: { wrapped: true, repeats: false, sorts: ['conversation', 'translate'] },
  lorebook: { wrapped: false, repeats: false, sorts: ['conversation', 'translate'] },
  authorNote: { wrapped: true, repeats: false, sorts: ['conversation'] },
  postEverything: { wrapped: false, repeats: false, sorts: ['conversation'] },
  chat: { wrapped: false, repeats: true, sorts: ['conversation'] },
  // 앞 메시지: the messages before the one translated, with the translations already made.
  recent: { wrapped: true, repeats: false, sorts: ['translate'] },
  // 원문: the text being translated.
  source: { wrapped: true, repeats: false, sorts: ['translate'] },
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
// count: how many messages before the source it holds.
export type RecentSlot = WrappedFields & { slot: 'recent'; count: number };
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
};

// No model layer: the task's role is the one place its model is chosen. Its text blocks carry no mark, since a
// card never replaces a translator's text.
export type TranslatePrompt = {
  task: 'translate';
  name: string;
  blocks: Block[];
  toggles: Toggle[];
  origin?: { id: string; name: string };
};

export type Prompt = ConversationPrompt | TranslatePrompt;
export type PromptOf<S extends PromptSort> = { conversation: ConversationPrompt; translate: TranslatePrompt }[S];

export const sortOf = (prompt: Prompt): PromptSort => prompt.task ?? 'conversation';
