import type { TranslatePrompt } from '../model/prompt';
// The user's own translator instructions. The two lines on acting were measured (provider-hub src/translate/prompt.js):
// an edit must keep them, or a character card gets acted instead of translated. The preamble of the user's file that
// casts the model as a hired human is left out: a default goes out under every user's key.
import INSTRUCTIONS from './translate-instructions.md?raw';

export type TranslationRequest = { kind: 'message'; index: number } | { kind: 'input'; text: string };

// Context goes in system messages apart from the source, so a command planted in the source cannot pass itself off
// as the story's context.
const CONTEXT = 'Context of the chat, for reference only. Never translate or output any of it.';

// The account's default translation prompt, added once (runtime/prompts).
export function translatorPrompt(): TranslatePrompt {
  const named = (name: string | null = null) => ({ id: crypto.randomUUID(), name });
  return {
    task: 'translate',
    name: '기본 번역',
    toggles: [],
    blocks: [
      { ...named('번역 지시'), kind: 'text', role: 'system', text: INSTRUCTIONS, mark: null },
      { ...named(), kind: 'slot', slot: 'description', role: 'system', wrapper: `${CONTEXT}\n---\nThe character: {{char}}.\n{{slot}}` },
      { ...named(), kind: 'slot', slot: 'persona', role: 'system', wrapper: `${CONTEXT}\n---\nThe user's character: {{user}}.\n{{slot}}` },
      {
        ...named(),
        kind: 'slot',
        slot: 'note',
        role: 'system',
        wrapper: `${CONTEXT}\nTranslator's notes from the user: fixed renderings of names and terms, and style the translation must follow.\n---\n{{slot}}`,
      },
      {
        ...named(),
        kind: 'slot',
        slot: 'recent',
        role: 'system',
        count: 4,
        wrapper: `${CONTEXT}\nKeep names, terms, and each speaker's speech level consistent with the translations already made.\n---\nThe messages right before the source, oldest first, with the translations already made:\n\n{{slot}}`,
      },
      { ...named(), kind: 'slot', slot: 'source', role: 'user', wrapper: null },
    ],
  };
}
