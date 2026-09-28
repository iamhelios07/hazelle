import { describe, expect, it } from 'vitest';
import type { Card } from './import/types';
import { cardPrompt, fillNames, unused } from './prompt';

const card = (over: Partial<Card> = {}): Card => ({
  name: 'Luna',
  nickname: null,
  description: '{{char}} is a lighthouse keeper.',
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
  regex: [],
  loreSettings: { scanDepth: null, tokenBudget: null, recursive: null, fullWordMatching: null },
  ...over,
});

describe('card prompt', () => {
  it('fills {{char}} with the nickname when there is one, and {{user}} with the user', () => {
    expect(fillNames('{{char}} greets {{User}} · {{bot}}', card({ nickname: 'Lu' }), 'jin')).toBe('Lu greets jin · Lu');
  });

  it('puts the card before the chat and its post-history instructions after it', () => {
    const chat = [{ role: 'user' as const, content: 'hi' }];
    const messages = cardPrompt(card({ scenario: 'A storm.', postHistoryInstructions: 'Stay terse, {{user}}.' }), 'jin', chat);
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain('Luna is a lighthouse keeper.');
    expect(messages[0]!.content).toContain('Scenario: A storm.');
    expect(messages.slice(1)).toEqual([...chat, { role: 'system', content: 'Stay terse, jin.' }]);
  });

  it('lets a card system prompt replace the main text, reaching it through {{original}}', () => {
    const [system] = cardPrompt(card({ systemPrompt: 'Be poetic. {{original}}' }), 'jin', []);
    expect(system!.content).toMatch(/^Be poetic\. Write Luna's next reply/);
  });

  it('counts what the prompt does not use yet, other CBS tags included', () => {
    const regex = [{ name: 'r', find: 'a', replace: 'b', stage: 'display' as const, flags: null }];
    expect(unused(card({ description: '{{getvar::mood}} {{char}} {{user}}', regex }), 3)).toEqual([
      { kind: 'lorebook', count: 3 },
      { kind: 'regex', count: 1 },
      { kind: 'cbs', count: 1 },
    ]);
  });
});
