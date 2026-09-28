import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../connectors/types';
import type { Prompt } from '../model/prompt';
import type { HistoryMessage } from './history';
import type { Card, LoreEntry, RegexScript } from './import/types';
import { assemble, unused, type PromptInput, type TooLong } from './pipeline';
import { renderChat } from './render';

// The user's own Risu preset "🏓 핑퐁 간소화" (design §4.2), block for block: its wrappers and marks as written,
// its long texts cut down around the parts that carry CBS. Its 장기 기억 block has no slot yet, so it is not here.
const starter: Prompt = {
  name: '🏓 핑퐁 간소화',
  toggles: [{ key: 'sims', label: '시뮬레이터 모드', kind: 'check', default: '0' }],
  authorNote: '',
  models: {},
  blocks: [
    { id: 'setting', name: null, kind: 'text', role: 'system', mark: null, text: '<System Setting>\nYour collaborator performs a single character, {{user}}.\nYou perform everything else: {{char}}, the world.\n</System Setting>\n\n---' },
    {
      id: 'description',
      name: null,
      kind: 'slot',
      slot: 'description',
      role: 'assistant',
      wrapper:
        "<Role-play Materials>\n\n[<char> (Main NPC)]\nThis profile is yours to perform. Everything here is {{char}}'s own — their tastes, opinions, and knowledge come from this profile and the scene, nowhere else.\n\n{{slot}}",
    },
    { id: 'persona', name: null, kind: 'slot', slot: 'persona', role: 'system', wrapper: "[<user> (Main PC)]\nThis profile belongs to your collaborator's character.\n{{slot}}" },
    { id: 'material-2', name: null, kind: 'text', role: 'system', mark: null, text: '# Material 2: Additional Information/Rules\nThis material is about the world, lore, other characters, internal rules, etc.' },
    { id: 'lorebook', name: null, kind: 'slot', slot: 'lorebook' },
    { id: 'material-3', name: null, kind: 'text', role: 'system', mark: null, text: '# Material 3: Past Events/Prelude Summary' },
    { id: 'guidelines', name: null, kind: 'text', role: 'system', mark: null, text: '</Role-play Materials>\n\n---\n\n<Guidelines>' },
    { id: 'global-note', name: '글노덮', kind: 'text', role: 'system', mark: 'globalNote', text: '' },
    { id: 'author-note', name: null, kind: 'slot', slot: 'authorNote', role: 'assistant', wrapper: null },
    { id: 'post-everything', name: null, kind: 'slot', slot: 'postEverything' },
    {
      id: 'main',
      name: '가이드라인 (중요!!!)',
      kind: 'text',
      role: 'system',
      mark: 'main',
      text: "# Premise\nYou write {{char}}. Your partner writes {{user}}.\n# Everyone else\nEvery other person acts on their own goals.\n{{#if {{getglobalvar::toggle_sims}}}}\n{{char}} is one person among many.\n{{/if}}\n\n</Guidelines>\n\n---\n",
    },
    { id: 'past', name: '과거 챗', kind: 'slot', slot: 'chat', range: { from: 0, to: -1 } },
    { id: 'last', name: '마지막 챗', kind: 'slot', slot: 'chat', range: { from: -1, to: null } },
  ],
};

const card = (over: Partial<Card> = {}): Card => ({
  name: 'Luna',
  nickname: null,
  description: '{{char}} keeps the lighthouse.',
  personality: '',
  scenario: '',
  greetings: ['The lamp is lit, {{user}}.'],
  exampleDialogue: '',
  systemPrompt: '',
  postHistoryInstructions: 'Keep it short. {{original}}',
  creatorNotes: '',
  creator: '',
  version: '',
  tags: [],
  variables: [['count', '0']],
  toggles: '',
  utility: false,
  bias: [],
  regex: [],
  loreSettings: { scanDepth: null, tokenBudget: null, recursive: null, fullWordMatching: null },
  ...over,
});

const script = (stage: RegexScript['stage'], find: string, replace: string): RegexScript => ({ name: stage, find, replace, stage, flags: null });

const lore = (id: string, content: string, over: Partial<LoreEntry> = {}) => ({
  id,
  value: { name: id, keys: [], secondaryKeys: [], content, enabled: true, constant: true, selective: false, useRegex: false, caseSensitive: false, insertionOrder: 0, priority: null, position: null, ...over },
});

const message = (id: string, role: HistoryMessage['role'], text: string): HistoryMessage => ({ id, role, text, time: null });

const scope = (over: Partial<PromptInput['scope']> = {}): PromptInput['scope'] => ({
  card: card(),
  persona: { name: 'jin', description: 'A traveler.' },
  prompt: starter,
  note: 'Rain tonight.',
  lore: [],
  messages: [message('g1', 'assistant', 'The lamp is lit, {{user}}.'), message('u1', 'user', 'Is it safe?'), message('a1', 'assistant', '{{setvar::mood::calm}}She nods. [OOC] ignore'), message('u2', 'user', 'Good.')],
  greeting: { index: 0 },
  toggle: (key) => (key === 'sims' ? '1' : null),
  model: { id: 'model', maxContext: null, prefill: null },
  clock: { now: Date.UTC(2026, 8, 28), timeZone: 'UTC' },
  pick: 'luna:chat',
  ...over,
});

const sentOf = (result: ChatMessage[] | TooLong) => {
  if ('kind' in result) throw new Error(`over budget: ${result.tokens} of ${result.budget}`);
  return result;
};
const build = (over: Partial<PromptInput['scope']> = {}) => sentOf(assemble({ scope: scope(over), seed: 'reply-1', countTokens: (text) => text.length, budget: null }));

describe('assemble', () => {
  it("builds the user's own prompt with a card's lorebook, regex, toggle and variables", () => {
    const entries = [
      lore('lighthouse', 'The lighthouse is old.', { constant: false, keys: ['lighthouse'] }),
      lore('born', '@@position before_desc\n{{char}} was born at sea.'),
      lore('mood', '@@depth 1\nMood: {{getvar::mood}}'),
      lore('later', '@@depth 0\nFinal A', { insertionOrder: 20 }),
      lore('sooner', '@@depth 0\nFinal B', { insertionOrder: 10 }),
    ];
    const regex = [script('process', ' \\[OOC\\].*', ''), script('display', 'nods', 'nods slowly')];
    const messages = [...scope().messages.slice(0, 3), message('u2', 'user', 'Good. Is the lighthouse lit?')];
    expect(build({ card: card({ regex }), lore: entries, messages })).toEqual([
      { role: 'system', content: '<System Setting>\nYour collaborator performs a single character, jin.\nYou perform everything else: Luna, the world.\n</System Setting>\n\n---' },
      {
        role: 'assistant',
        content:
          "<Role-play Materials>\n\n[Luna (Main NPC)]\nThis profile is yours to perform. Everything here is Luna's own — their tastes, opinions, and knowledge come from this profile and the scene, nowhere else.\n\nLuna was born at sea.\n\nLuna keeps the lighthouse.",
      },
      { role: 'system', content: "[jin (Main PC)]\nThis profile belongs to your collaborator's character.\nA traveler." },
      { role: 'system', content: '# Material 2: Additional Information/Rules\nThis material is about the world, lore, other characters, internal rules, etc.' },
      { role: 'system', content: 'The lighthouse is old.' },
      { role: 'system', content: '# Material 3: Past Events/Prelude Summary' },
      { role: 'system', content: '</Role-play Materials>\n\n---\n\n<Guidelines>' },
      { role: 'system', content: 'Keep it short.' },
      { role: 'assistant', content: 'Rain tonight.' },
      // 최종 삽입 (design §4.2): the higher insertion order goes later.
      { role: 'system', content: 'Final B' },
      { role: 'system', content: 'Final A' },
      { role: 'system', content: '# Premise\nYou write Luna. Your partner writes jin.\n# Everyone else\nEvery other person acts on their own goals.\nLuna is one person among many.\n\n</Guidelines>\n\n---' },
      { role: 'assistant', content: 'The lamp is lit, jin.' },
      { role: 'user', content: 'Is it safe?' },
      { role: 'assistant', content: 'She nods.' },
      { role: 'system', content: 'Mood: calm' },
      { role: 'user', content: 'Good. Is the lighthouse lit?' },
    ]);
    expect(renderChat('display', scope({ card: card({ regex }), messages })).texts[2]).toBe('She nods slowly. [OOC] ignore');
  });

  it('leaves out what a toggle turns off, fills {{position}} and @@inject_at, and puts 최종 삽입 last when the prompt has no such slot', () => {
    const blocks: Prompt['blocks'] = [
      { id: 'notes', name: null, kind: 'text', role: 'system', mark: null, text: 'Notes: {{position::bell}}' },
      ...starter.blocks.filter((block) => (block.kind === 'text' ? block.mark === 'main' : block.slot === 'chat')),
    ];
    const entries = [lore('end', '@@depth 0\nLast word'), lore('bell', '@@position pt_bell\nThe bell rings.'), lore('kind', '@@inject_at main\nStay kind.')];
    const sent = build({ prompt: { ...starter, blocks }, toggle: (key) => (key === 'sims' ? '0' : null), lore: entries });
    expect(sent[0]).toEqual({ role: 'system', content: 'Notes: The bell rings.' });
    expect(sent[1]!.content).not.toContain('one person among many');
    expect(sent[1]!.content.endsWith('---\n Stay kind.')).toBe(true);
    expect(sent.at(-1)).toEqual({ role: 'system', content: 'Last word' });
  });

  it('keeps an entry that fired for an earlier reply after @@keep_activate_after_match, and drops one after @@dont_activate_after_match', () => {
    const entries = [
      lore('kept', '@@keep_activate_after_match\nkept', { constant: false, keys: ['storm'] }),
      lore('once', '@@dont_activate_after_match\nonce', { constant: false, keys: ['storm', 'Good'] }),
    ];
    const messages = [message('u1', 'user', 'A storm comes.'), message('a1', 'assistant', 'She shivers.'), message('u2', 'user', 'Good.')];
    const sent = build({ card: card({ loreSettings: { scanDepth: 1, tokenBudget: null, recursive: null, fullWordMatching: null } }), lore: entries, messages, greeting: null });
    const lorebook = sent.filter(({ content }) => content === 'kept' || content === 'once');
    expect(lorebook).toEqual([{ role: 'system', content: 'kept' }]);
  });

  it('drops the oldest chat messages until the prompt fits its budget, keeps the last one and the rest of the prompt, and refuses what still does not fit', () => {
    const tokens = (text: string) => countTokens(text, { disallowedSpecial: new Set() });
    const messages = Array.from({ length: 40 }, (_, i) => message(`m${i}`, i % 2 ? 'assistant' : 'user', `Message ${i}: ${'The lighthouse keeps its light. '.repeat(20)}`));
    const input = { scope: scope({ messages, greeting: null }), seed: 'reply-1', countTokens: tokens };
    const size = (sent: ChatMessage[]) => sent.reduce((sum, { content }) => sum + tokens(content), 0);
    const inChat = ({ content }: ChatMessage) => content.startsWith('Message ');
    const whole = sentOf(assemble({ ...input, budget: null }));
    const budget = Math.floor(size(whole) / 2);
    const sent = sentOf(assemble({ ...input, budget }));
    expect(size(sent)).toBeLessThanOrEqual(budget);
    expect(sent.filter((each) => !inChat(each))).toEqual(whole.filter((each) => !inChat(each)));
    const kept = sent.filter(inChat);
    expect(kept.length).toBeLessThan(messages.length);
    expect(kept).toEqual(whole.filter(inChat).slice(-kept.length));
    expect(assemble({ ...input, budget: 100 })).toMatchObject({ kind: 'too-long', budget: 100 });
  });
});

describe('renderChat', () => {
  const counting: RegexScript[] = [
    script('output', 'nods', 'nods{{addvar::count::1}}'),
    script('process', 'She', '{{addvar::count::1}}She'),
    script('display', 'She', '{{addvar::count::1}}She'),
  ];
  const messages = [message('a1', 'assistant', '{{addvar::count::1}}She nods.'), message('u1', 'user', '{{getvar::count}}'), message('a2', 'assistant', 'She nods. {{randint::1::1000000}}')];

  it("writes a message's variables once, in its own text and its output stage, never in the stages chained after", () => {
    const over = { card: card({ regex: counting, greetings: [] }), messages, greeting: null };
    const prompt = renderChat('prompt', scope(over));
    const display = renderChat('display', scope(over));
    expect(prompt.variables.get('count')).toBe('3');
    expect(display.variables).toEqual(prompt.variables);
    expect([prompt.texts[1], display.texts[1]]).toEqual(['2', '2']);
  });

  it('rolls a random tag in a message the same on screen as in the prompt', () => {
    const over = { card: card({ greetings: [] }), messages, greeting: null };
    expect(renderChat('display', scope(over)).texts[2]).toBe(renderChat('prompt', scope(over)).texts[2]);
    expect(renderChat('prompt', scope(over)).texts[2]).toMatch(/^She nods\. \d+$/);
  });
});

describe('unused', () => {
  it('counts what the prompt does not use yet', () => {
    expect(unused(card({ bias: [['a', 1]], utility: true }))).toEqual([
      { kind: 'bias', count: 1 },
      { kind: 'utility', count: 1 },
    ]);
  });
});
