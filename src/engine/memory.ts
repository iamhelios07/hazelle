import type { MemoryPrompt } from '../model/prompt';

// What the 장기 기억 slot did for one request. sent: the records it sent. covered: the leading messages memory covers,
// which the chat slots leave out. missing: how many of those went with no memory standing for them (stale, over the
// budget, forgotten, or the slot did not reach the request).
export type MemorySent = { sent: string[]; covered: number; missing: number };

// The account's default memory prompt, added once (runtime/prompts).
export function memoryTaskPrompt(): MemoryPrompt {
  const named = (name: string | null = null) => ({ id: crypto.randomUUID(), name });
  return {
    task: 'memory',
    name: '기본 기억',
    toggles: [],
    blocks: [
      { ...named('정리 지시'), kind: 'text', role: 'system', text: 'Summarize the messages into memory records.', mark: null },
      { ...named(), kind: 'slot', slot: 'description', role: 'system', wrapper: null },
      { ...named(), kind: 'slot', slot: 'persona', role: 'system', wrapper: null },
      { ...named(), kind: 'slot', slot: 'memory', role: 'system', wrapper: null },
      { ...named(), kind: 'slot', slot: 'span', role: 'user', wrapper: null },
    ],
  };
}
