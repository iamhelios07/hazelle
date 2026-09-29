import { describe, expect, it } from 'vitest';
import type { HistoryMessage } from './history';
import type { Card } from './import/types';
import type { ChatScope } from './render';
import { translationMessages } from './translate';

const card: Card = {
  name: 'Luna',
  nickname: null,
  description: '{{char}} keeps the lighthouse.',
  personality: '',
  scenario: '',
  greetings: [],
  exampleDialogue: '',
  systemPrompt: '',
  postHistoryInstructions: '',
  creatorNotes: '',
  creator: '',
  version: '',
  tags: [],
  variables: [],
  toggles: '',
  utility: false,
  bias: [],
  regex: [{ name: 'shout', find: 'lamp', replace: 'LAMP', stage: 'display', flags: null }],
  loreSettings: { scanDepth: null, tokenBudget: null, recursive: null, fullWordMatching: null },
};
const message = (id: string, role: HistoryMessage['role'], text: string): HistoryMessage => ({ id, seed: id, role, text, time: null });
const scope: ChatScope = {
  card,
  persona: { name: 'jin', description: '' },
  prompt: null,
  note: null,
  lore: [],
  messages: [message('u1', 'user', 'Is the lamp lit?'), message('a1', 'assistant', 'The lamp is lit, {{user}}.')],
  greeting: null,
  toggle: () => null,
  model: null,
  clock: { now: 0, timeZone: 'UTC' },
  pick: 'luna:chat',
};

describe('translationMessages', () => {
  it('translates a message as it is displayed into Korean, with the character and the earlier messages and their translations as context', () => {
    const { source, messages } = translationMessages(scope, ['등불 켜졌어?', null], { kind: 'message', index: 1 });
    expect(source).toBe('The LAMP is lit, jin.');
    expect(messages.map(({ role }) => role)).toEqual(['system', 'system', 'user']);
    expect(messages[0]!.content).toContain('Target language: 한국어.');
    expect(messages[1]!.content).toContain('The character: Luna.\nLuna keeps the lighthouse.');
    expect(messages[1]!.content).toContain('[jin]\nIs the LAMP lit?\nIts translation:\n등불 켜졌어?');
    expect(messages[2]).toEqual({ role: 'user', content: 'The LAMP is lit, jin.' });
  });

  it('translates the user’s new message into English after every message of the chat', () => {
    const { messages } = translationMessages(scope, [null, null], { kind: 'input', text: '응, 고마워.' });
    expect(messages[0]!.content).toContain('Target language: English.');
    expect(messages[1]!.content).toContain('[Luna]\nThe LAMP is lit, jin.');
    expect(messages.at(-1)).toEqual({ role: 'user', content: '응, 고마워.' });
  });
});
