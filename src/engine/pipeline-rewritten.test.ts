import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../connectors/types';
import { rewritten, type Assembled, type From } from './pipeline';

const chat: From = { kind: 'block', name: null, slot: 'chat' };
const main: From = { kind: 'block', name: '메인', slot: null };
const built: ChatMessage[] = [
  { role: 'system', content: 'main prompt' },
  { role: 'user', content: 'first hello' },
  { role: 'assistant', content: 'first reply' },
  { role: 'user', content: 'second hello' },
];
const prompt: Assembled = { messages: built, parts: [main, chat, chat, chat].map((from, at) => ({ from, tokens: built[at]!.content.length })), lore: null, memory: null, dropped: 2 };
const note: ChatMessage = { role: 'system', content: 'from the script' };
const count = (text: string) => text.length;

describe('a request a script rewrote', () => {
  it('keeps the parts of the messages left as built, counts the script’s own, and holds the budget by the oldest chat messages', () => {
    const edited = [built[0]!, built[1]!, note, built[2]!, built[3]!];
    expect(rewritten(prompt, edited, count, null)).toEqual({ ...prompt, messages: edited, parts: [prompt.parts[0], prompt.parts[1], { from: { kind: 'script' }, tokens: 15 }, prompt.parts[2], prompt.parts[3]] });
    expect(rewritten(prompt, edited, count, 50)).toMatchObject({ messages: [built[0], note, built[2], built[3]], dropped: 3 });
    expect(rewritten(prompt, edited, count, 30)).toEqual({ kind: 'too-long', tokens: 38, budget: 30 });
  });
});
