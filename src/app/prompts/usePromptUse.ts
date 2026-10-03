import { useMemo } from 'react';
import { chatPrompt } from '../../runtime/prompts';
import { useChats, usePrompts, useSettings, useStore } from '../session';

// How many chats use each prompt, their own or the default, and when one of them was last written to.
export type PromptUse = { chats: number; at: number | null };

export function usePromptUse(): ReadonlyMap<string, PromptUse> {
  const store = useStore();
  const chats = useChats();
  const prompts = usePrompts();
  const settings = useSettings();
  return useMemo(() => {
    const uses = new Map<string, PromptUse>();
    for (const item of chats) {
      const choice = chatPrompt(store, item.chat);
      if (choice.kind !== 'prompt') continue;
      const use = uses.get(choice.prompt.id) ?? { chats: 0, at: null };
      const at = item.at === null ? use.at : Math.max(use.at ?? 0, item.at);
      uses.set(choice.prompt.id, { chats: use.chats + 1, at });
    }
    return uses;
    // settings: the default prompt, which chats without their own follow.
  }, [store, chats, settings, prompts]);
}

export const EMPTY_USE: PromptUse = { chats: 0, at: null };

