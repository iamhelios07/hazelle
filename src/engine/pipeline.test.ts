import { describe, expect, it } from 'vitest';
import type { Card } from './import/types';
import { buildPrompt, unused } from './pipeline';
import { render } from './render';

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

describe('render', () => {
  it('fills {{char}} with the nickname when there is one, and {{user}} with the user; with no character {{char}} stays', () => {
    expect(render('display', '{{char}} greets {{User}} · {{bot}}', { card: card({ nickname: 'Lu' }), user: 'jin' })).toBe('Lu greets jin · Lu');
    expect(render('prompt', '{{char}} greets {{user}}', { card: null, user: 'jin' })).toBe('{{char}} greets jin');
  });
});

describe('buildPrompt', () => {
  const scope = (over: Partial<Card> = {}) => ({ card: card(over), user: 'jin' });

  it('puts the card before the chat and its post-history instructions after it', () => {
    const messages = buildPrompt({ scope: scope({ scenario: 'A storm.', postHistoryInstructions: 'Stay terse, {{user}}.' }), history: [{ role: 'user', text: 'hi' }] });
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain('Luna is a lighthouse keeper.');
    expect(messages[0]!.content).toContain('Scenario: A storm.');
    expect(messages.slice(1)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'Stay terse, jin.' },
    ]);
  });

  it('renders every history message for the prompt, and leaves a failed reply out', () => {
    const history = [
      { role: 'assistant' as const, text: '어서 와, {{user}}. 나는 {{char}}야.' },
      { role: 'user' as const, text: '안녕' },
      { role: 'assistant' as const, text: '' },
    ];
    expect(buildPrompt({ scope: scope(), history }).slice(1)).toEqual([
      { role: 'assistant', content: '어서 와, jin. 나는 Luna야.' },
      { role: 'user', content: '안녕' },
    ]);
  });

  it('lets a card system prompt replace the main text, reaching it through {{original}}', () => {
    const [system] = buildPrompt({ scope: scope({ systemPrompt: 'Be poetic. {{original}}' }), history: [] });
    expect(system!.content).toMatch(/^Be poetic\. Write Luna's next reply/);
  });
});

describe('unused', () => {
  it('counts what the prompt does not use yet, other CBS tags included', () => {
    const regex = [{ name: 'r', find: 'a', replace: 'b', stage: 'display' as const, flags: null }];
    expect(unused(card({ description: '{{getvar::mood}} {{char}} {{user}}', regex }), 3)).toEqual([
      { kind: 'lorebook', count: 3 },
      { kind: 'regex', count: 1 },
      { kind: 'cbs', count: 1 },
    ]);
  });
});
