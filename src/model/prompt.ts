import type { Assignment } from '../connectors/assignment';

export type Role = 'system' | 'user' | 'assistant';

// The slot kinds (design §4.2): a feature that brings something new to the prompt adds a row.
// wrapped: the slot takes a role and a 감싸는 글 with {{slot}} where its content goes. repeats: it may
// be placed more than once.
export const SLOTS = {
  description: { wrapped: true, repeats: false },
  persona: { wrapped: true, repeats: false },
  lorebook: { wrapped: false, repeats: false },
  authorNote: { wrapped: true, repeats: false },
  postEverything: { wrapped: false, repeats: false },
  chat: { wrapped: false, repeats: true },
} as const;
export type SlotKind = keyof typeof SLOTS;
type Wrapped = { [K in SlotKind]: (typeof SLOTS)[K]['wrapped'] extends true ? K : never }[SlotKind];

// Counted in chat messages: a negative number counts from the end, and to null runs to the end.
// Past chat is {from: 0, to: -1}; the last message is {from: -1, to: null}.
export type ChatRange = { from: number; to: number | null };

type Named = { id: string; name: string | null };
// mark: the text a card replaces, main by its system prompt and globalNote by its post-history
// instructions, with {{original}} in the card's text standing for this block's text.
export type TextBlock = Named & { kind: 'text'; role: Role; text: string; mark: 'main' | 'globalNote' | null };
export type WrappedSlot = Named & { kind: 'slot'; slot: Wrapped; role: Role; wrapper: string | null };
export type ChatSlot = Named & { kind: 'slot'; slot: 'chat'; range: ChatRange };
export type PlainSlot = Named & { kind: 'slot'; slot: Exclude<SlotKind, Wrapped | 'chat'> };
export type Block = TextBlock | WrappedSlot | ChatSlot | PlainSlot;

// key is what conditions name ({{#when::toggle::key}}, toggle_key); label is what screens show. Values are
// strings because CBS reads them: a check is '1' or '0', a choice is its option's index.
export type Toggle = { key: string; label: string } & ({ kind: 'check'; default: '0' | '1' } | { kind: 'choice'; options: string[]; default: string });

// A character's or 캐릭터 없이's toggle values by key, over the declared defaults (design §4.2).
export type ToggleValues = Record<string, string>;

// Kind `prompt` (design §4.2). authorNote is the default 작가의 노트, which a chat's own note replaces.
// origin is a copy's original, named as it was then. imported marks a prompt made from a Risu preset; a copy
// does not inherit it.
export type Prompt = {
  name: string;
  blocks: Block[];
  toggles: Toggle[];
  authorNote: string;
  models: Assignment;
  origin?: { id: string; name: string };
  imported?: 'risu-preset';
};
