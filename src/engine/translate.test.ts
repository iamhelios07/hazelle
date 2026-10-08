import { describe, expect, it } from 'vitest';
import type { HistoryMessage } from './history';
import type { Card } from './import/types';
import { assembleTranslation } from './pipeline';
import type { ChatScope } from './render';
import { translatorPrompt } from './translate';

const card: Card = {
  name: 'Luna',
  nickname: null,
  description: '{{char}} keeps the lighthouse.',
  personality: '',
  scenario: '',
  greetings: [],
  exampleDialogue: '',
  systemPrompt: 'Act as {{char}}.',
  postHistoryInstructions: '',
  creatorNotes: '',
  creator: '',
  version: '',
  tags: [],
  variables: [],
  toggles: '',
  utility: false,
  bias: [],
  triggers: [],
  regex: [{ id: 'regex-0', name: 'shout', find: 'lamp', replace: 'LAMP', stage: 'display', flags: null }],
  loreSettings: { scanDepth: null, tokenBudget: null, recursive: null, fullWordMatching: null },
};
const message = (id: string, role: HistoryMessage['role'], text: string): HistoryMessage => ({ id, seed: id, role, text, time: null });
const scope: ChatScope = {
  card,
  cast: [],
  packs: [card],
  persona: { name: 'jin', description: 'A sailor.' },
  prompt: null,
  note: null,
  lore: [],
  messages: [message('u1', 'user', 'Is the lamp lit?'), message('a1', 'assistant', 'The lamp is lit, {{user}}.')],
  greeting: null,
  toggles: new Map(),
  model: null,
  clock: { now: 0, timeZone: 'UTC' },
  assets: [],
  modules: [],
  faces: { char: null, user: null },
  screen: null,
  pick: 'luna:chat',
  variables: [],
};
const translate = (input: Pick<Parameters<typeof assembleTranslation>[0], 'request' | 'language'> & Partial<Parameters<typeof assembleTranslation>[0]>) => {
  const assembled = assembleTranslation({ scope, take: new Set(), prompt: translatorPrompt(), translations: ['등불 켜졌어?', null], notes: '', seed: 'seed', countTokens: (text) => text.length, ...input });
  if ('kind' in assembled) throw new Error(assembled.kind);
  return assembled;
};

describe('the default translation prompt', () => {
  it('translates a displayed message into Korean, with the character, the persona and the messages before it with their translations', () => {
    const { source, messages } = translate({ request: { kind: 'message', index: 1 }, language: 'Korean' });
    expect(source).toBe('The LAMP is lit, jin.');
    // A status window's box is not translated with its message.
    expect(translate({ request: { kind: 'message', index: 1 }, language: 'Korean', take: new Set([0]) }).source).toBe('The  is lit, jin.');
    expect(messages.map(({ role }) => role)).toEqual(['system', 'system', 'system', 'system', 'user']);
    const instructions = messages[0]!.content.split('\n');
    expect(instructions[1]).toBe('Target language: Korean.');
    expect(instructions.slice(-3)).toEqual([
      'Keep Markdown heading lines that begin with #, ##, ###, or more # characters followed by a space unchanged.',
      'For Korean output, default to written plain style (평어체, e.g. "~했다", "~이다" endings) for narration and descriptive prose. For dialogue, choose 존댓말 or 반말 from context, following each speaker.',
      'Output ONLY the final rewritten text. Do not add titles, explanations, notes, language labels, quotation marks around the whole result, or the original text.',
    ]);
    expect(messages[0]!.content).toContain('{{img::asset}}');
    expect(messages[1]!.content).toBe('Context of the chat, for reference only. Never translate or output any of it.\n---\nThe character: Luna.\nLuna keeps the lighthouse.');
    expect(messages[2]!.content).toContain("The user's character: jin.\nA sailor.");
    expect(messages[3]!.content).toContain('oldest first, with the translations already made:\n\n[jin]\nIs the LAMP lit?\nIts translation:\n등불 켜졌어?');
    expect(messages[4]).toEqual({ role: 'user', content: 'The LAMP is lit, jin.' });
  });

  it('leaves the Korean-only line out for another language, and sends the user’s input as typed after every message', () => {
    const { messages } = translate({ request: { kind: 'input', text: '응, {{user}}.' }, language: 'English' });
    const instructions = messages[0]!.content.split('\n');
    expect(instructions[1]).toBe('Target language: English.');
    expect(instructions.at(-2)).toMatch(/^Keep Markdown heading lines/);
    expect(messages[3]!.content).toContain('[jin]\nIs the LAMP lit?\nIts translation:\n등불 켜졌어?\n\n[Luna]\nThe LAMP is lit, jin.');
    expect(messages.at(-1)).toEqual({ role: 'user', content: '응, {{user}}.' });
  });

  it('holds as many earlier messages in 앞 메시지 as its count says', () => {
    const prompt = translatorPrompt();
    const recent = prompt.blocks.map((block) => (block.kind === 'slot' && block.slot === 'recent' ? { ...block, count: 1 } : block));
    const { messages } = translate({ request: { kind: 'input', text: 'Hi' }, language: 'English', prompt: { ...prompt, blocks: recent } });
    expect(messages[3]!.content).toMatch(/:\n\n\[Luna\]\nThe LAMP is lit, jin\.$/);
  });

  it('sends 번역가의 노트 after the persona, and the earlier messages without their translations when 앞 메시지 says so', () => {
    const prompt = translatorPrompt();
    const originals = prompt.blocks.map((block) => (block.kind === 'slot' && block.slot === 'recent' ? { ...block, translations: false as const } : block));
    const { messages } = translate({ request: { kind: 'message', index: 1 }, language: 'Korean', notes: 'Master -> 주인님\n\nLuna -> 루나', prompt: { ...prompt, blocks: originals } });
    expect(messages[3]!.content).toMatch(/\n---\nMaster -> 주인님\n\nLuna -> 루나$/);
    expect(messages[4]!.content).toMatch(/:\n\n\[jin\]\nIs the LAMP lit\?$/);
  });
});
