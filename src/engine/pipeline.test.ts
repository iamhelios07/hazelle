import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../connectors/types';
import type { Memory, MemoryRecord } from '../model/memory';
import type { Prompt } from '../model/prompt';
import type { HistoryMessage } from './history';
import type { Card, LoreEntry, RegexScript } from './import/types';
import { assemble, rewritten, unused, type Assembled, type From, type PromptInput } from './pipeline';
import { printOf, speakersOf, type ChatRead } from './memory';
import { RETRIEVED_HEADING } from './retrieval';
import { renderChat } from './render';

// The user's own Risu preset "🏓 핑퐁 간소화" (design §4.2), block for block: its wrappers and marks as written,
// its long texts cut down around the parts that carry CBS.
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
    { id: 'memory', name: null, kind: 'slot', slot: 'memory', role: 'system', wrapper: null },
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
  triggers: [],
  loreSettings: { scanDepth: null, tokenBudget: null, recursive: null, fullWordMatching: null },
  ...over,
});

const script = (stage: RegexScript['stage'], find: string, replace: string): RegexScript => ({ id: find, name: stage, find, replace, stage, flags: null });

const lore = (id: string, content: string, over: Partial<LoreEntry> = {}, parent: string | null = null) => ({
  id,
  parent,
  value: { name: id, keys: [], secondaryKeys: [], content, enabled: true, constant: true, selective: false, useRegex: false, caseSensitive: false, insertionOrder: 0, priority: null, position: null, ...over },
});

const message = (id: string, role: HistoryMessage['role'], text: string): HistoryMessage => ({ id, message: id, seed: id, role, text, time: null });

const scope = ({ card: own = card(), ...over }: Partial<PromptInput['scope']> = {}): PromptInput['scope'] => ({
  card: own,
  cast: [],
  packs: own ? [own] : [],
  persona: { name: 'jin', description: 'A traveler.' },
  prompt: starter,
  note: 'Rain tonight.',
  lore: [],
  messages: [message('g1', 'assistant', 'The lamp is lit, {{user}}.'), message('u1', 'user', 'Is it safe?'), message('a1', 'assistant', '{{setvar::mood::calm}}She nods. [OOC] ignore'), message('u2', 'user', 'Good.')],
  greeting: { index: 0 },
  toggles: new Map([['sims', '1']]),
  model: { id: 'model', maxContext: null, prefill: null },
  clock: { now: Date.UTC(2026, 8, 28), timeZone: 'UTC' },
  assets: [],
  modules: [],
  faces: { char: null, user: null },
  screen: null,
  pick: 'luna:chat',
  variables: [],
  ...over,
});

const assembledOf = (result: ReturnType<typeof assemble>) => {
  if ('kind' in result) throw new Error(result.kind);
  return result;
};
const sentOf = (result: ReturnType<typeof assemble>) => assembledOf(result).messages;
const input = (over: Partial<PromptInput['scope']> = {}): PromptInput => ({ scope: scope(over), seed: 'reply-1', countTokens: (text) => text.length, budget: null, tools: [], continuing: false, memory: null });
const build = (over: Partial<PromptInput['scope']> = {}) => sentOf(assemble(input(over)));

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
      { role: 'system', content: '# Premise\nYou write Luna. Your partner writes jin.\n# Everyone else\nEvery other person acts on their own goals.\nLuna is one person among many.\n\n</Guidelines>\n\n---', cache: true },
      { role: 'assistant', content: 'The lamp is lit, jin.' },
      { role: 'user', content: 'Is it safe?' },
      { role: 'assistant', content: 'She nods.' },
      { role: 'system', content: 'Mood: calm' },
      { role: 'user', content: 'Good. Is the lighthouse lit?', cache: true },
    ]);
    expect(renderChat('display', scope({ card: card({ regex }), messages })).texts[2]).toBe('She nods slowly. [OOC] ignore');
  });

  it("puts each 등장인물 under its name after the chat's character, its text and its own lorebook entries read as its own {{char}}", () => {
    const mira = card({ name: 'Mira', description: '{{char}} likes apples.', personality: 'shy' });
    const entries = [lore('orchard', '{{char}} tends the orchard.', {}, 'mira'), lore('gate', '{{char}} guards the gate.', {}, 'module')];
    const sent = build({ cast: [{ id: 'mira', card: mira }], lore: entries });
    expect(sent.slice(0, 2)).toEqual([
      { role: 'system', content: '<System Setting>\nYour collaborator performs a single character, jin.\nYou perform everything else: Luna, the world.\n</System Setting>\n\n---' },
      {
        role: 'assistant',
        content:
          "<Role-play Materials>\n\n[Luna (Main NPC)]\nThis profile is yours to perform. Everything here is Luna's own — their tastes, opinions, and knowledge come from this profile and the scene, nowhere else.\n\nLuna keeps the lighthouse.\n\n[Mira]\nMira likes apples.\n\nMira's personality: shy",
      },
    ]);
    expect(sent).toContainEqual({ role: 'system', content: 'Mira tends the orchard.' });
    expect(sent).toContainEqual({ role: 'system', content: 'Luna guards the gate.' });
  });

  it('marks the message a block marked 여기까지 캐시 ends on, the last one before the chat, and the chat’s last message rather than a block after it', () => {
    const prompt: Prompt = {
      ...starter,
      blocks: [
        { id: 'rules', name: null, kind: 'text', role: 'system', mark: null, text: 'Rules.', cache: true },
        { id: 'more', name: null, kind: 'text', role: 'system', mark: null, text: 'More.' },
        { id: 'chat', name: null, kind: 'slot', slot: 'chat', range: { from: 0, to: null } },
        { id: 'after', name: null, kind: 'text', role: 'system', mark: null, text: 'After.' },
      ],
    };
    const messages = [message('u1', 'user', 'Hi.'), message('a1', 'assistant', 'Hello.')];
    expect(build({ prompt, messages, greeting: null })).toEqual([
      { role: 'system', content: 'Rules.', cache: true },
      { role: 'system', content: 'More.', cache: true },
      { role: 'user', content: 'Hi.' },
      { role: 'assistant', content: 'Hello.', cache: true },
      { role: 'system', content: 'After.' },
    ]);
  });

  it('says which block, lorebook entry or instruction each sent message came from, with its count, and why each entry fired', () => {
    const blocks: Prompt['blocks'] = [
      { id: 'rules', name: null, kind: 'text', role: 'system', mark: null, text: 'Rules.' },
      { id: 'lorebook', name: null, kind: 'slot', slot: 'lorebook' },
      { id: 'past', name: '과거 챗', kind: 'slot', slot: 'chat', range: { from: 0, to: null } },
    ];
    const entries = [lore('lighthouse', 'The lighthouse is old.', { constant: false, keys: ['lighthouse'] }), lore('mood', '@@depth 1\nMood: calm')];
    const messages = [message('u1', 'user', 'Is the lighthouse lit?'), message('a1', 'assistant', 'It flick')];
    const result = assembledOf(assemble({ ...input({ prompt: { ...starter, blocks }, lore: entries, messages, greeting: null }), continuing: true }));
    expect(result.parts.map(({ from }) => from)).toEqual([
      { kind: 'block', name: null, slot: null },
      { kind: 'lore', name: 'lighthouse', slot: 'lorebook' },
      { kind: 'block', name: '과거 챗', slot: 'chat' },
      { kind: 'depth', name: 'mood', depth: 1 },
      { kind: 'block', name: '과거 챗', slot: 'chat' },
      { kind: 'continue' },
    ]);
    expect(result.parts[0]!.tokens).toBe('Rules.'.length);
    expect(result.messages.slice(-2).map(({ role }) => role)).toEqual(['assistant', 'user']);
    expect(result.lore).toEqual([
      { id: 'lighthouse', name: 'lighthouse', why: { kind: 'keys', matched: [{ query: 'primary', key: 'lighthouse', source: { kind: 'message', id: 'u1' } }] }, fate: { kind: 'placed', tokens: 22 } },
      { id: 'mood', name: 'mood', why: { kind: 'constant' }, fate: { kind: 'placed', tokens: 10 } },
    ]);
  });

  it('leaves out what a toggle turns off, fills {{position}} and @@inject_at, and puts 최종 삽입 last when the prompt has no such slot', () => {
    const blocks: Prompt['blocks'] = [
      { id: 'notes', name: null, kind: 'text', role: 'system', mark: null, text: 'Notes: {{position::bell}}' },
      ...starter.blocks.filter((block) => (block.kind === 'text' ? block.mark === 'main' : block.slot === 'chat')),
    ];
    const entries = [lore('end', '@@depth 0\nLast word'), lore('bell', '@@position pt_bell\nThe bell rings.'), lore('kind', '@@inject_at main\nStay kind.')];
    const sent = build({ prompt: { ...starter, blocks }, toggles: new Map([['sims', '0']]), lore: entries });
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

  it('sends a lorebook entry as the text its cost was counted on, whichever way its random tag rolls', () => {
    const blocks: Prompt['blocks'] = [{ id: 'lorebook', name: null, kind: 'slot', slot: 'lorebook' }];
    const entries = [lore('coin', `{{random::short::${'long '.repeat(20)}}}`)];
    const sizes = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const result = assembledOf(assemble({ ...input({ prompt: { ...starter, blocks }, lore: entries }), seed: `reply-${i}` }));
      expect(result.lore![0]!.fate).toEqual({ kind: 'placed', tokens: result.parts[0]!.tokens });
      sizes.add(result.parts[0]!.tokens);
    }
    expect(sizes.size).toBe(2);
  });

  it('chooses the first fitting cut when overlapping signed ranges and depth entries make costs nonmonotone', () => {
    const messages = [5, 50, 1, 40, 2].map((length, index) => message(`m${index}`, 'user', String(index).repeat(length)));
    const blocks: Prompt['blocks'] = [
      { id: 'first', name: null, kind: 'slot', slot: 'chat', range: { from: 0, to: 1 } },
      { id: 'tail', name: null, kind: 'slot', slot: 'chat', range: { from: -2, to: null } },
    ];
    const result = assembledOf(assemble({ ...input({ messages, greeting: null, prompt: { ...starter, blocks }, lore: [lore('depth', '@@depth 2\nabc')] }), budget: 47, countTokens: (text) => text.length }));
    expect(result.dropped).toBe(2);
    expect(result.messages.map(({ content }) => content)).toEqual(['2', 'abc', '3'.repeat(40), '44']);
    expect(result.parts.reduce((sum, { tokens }) => sum + tokens, 0)).toBe(46);
    expect(result.messages.at(-1)!.cache).toBe(true);
  });

  it('counts only texts demanded by the slots, with no budget, a fitting first cut, or a short moving range', () => {
    const messages = [message('long', 'user', 'long unused tail'), message('short', 'user', 'x'), message('tail', 'user', 'tail')];
    const counted = (from: number, to: number | null, budget: number | null) => {
      const texts: string[] = [];
      const blocks: Prompt['blocks'] = [{ id: 'chat', name: null, kind: 'slot', slot: 'chat', range: { from, to } }];
      const result = assembledOf(assemble({ ...input({ card: null, lore: [], messages, greeting: null, prompt: { ...starter, blocks } }), budget, countTokens: (text) => { texts.push(text); return text.length; } }));
      return { result, texts };
    };
    expect(counted(-1, null, null).texts).toEqual(['tail']);
    expect(counted(-1, null, 4).texts).toEqual(['tail']);
    const moved = counted(0, 1, 1);
    expect(moved.texts).toEqual(['long unused tail', 'x']);
    expect(moved.result.dropped).toBe(1);
    expect(moved.result.messages.map(({ content }) => content)).toEqual(['x']);
  });

  it('drops the oldest chat messages until the prompt fits its budget, keeps the last one and the rest of the prompt, and refuses what still does not fit', () => {
    const tokens = (text: string) => countTokens(text, { disallowedSpecial: new Set() });
    const messages = Array.from({ length: 40 }, (_, i) => message(`m${i}`, i % 2 ? 'assistant' : 'user', `Message ${i}: ${'The lighthouse keeps its light. '.repeat(20)}`));
    const input = { scope: scope({ messages, greeting: null }), seed: 'reply-1', countTokens: tokens, tools: [], continuing: false, memory: null };
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

describe('a request whose commands ran away', () => {
  it('is not built', () => {
    expect(assemble(input({ card: card({ description: '{{description}}{{description}}' }) }))).toEqual({ kind: 'runaway' });
  });
});

describe('assemble with memory', () => {
  const messages = [
    message('m0', 'user', '{{setvar::mood::calm}}We reach the lighthouse.'),
    message('m1', 'assistant', 'Luna opens the door.'),
    message('m2', 'user', 'I promise to come back.'),
    message('m3', 'assistant', 'Luna nods.'),
    message('m4', 'user', 'Morning comes.'),
    message('m5', 'assistant', 'Luna is {{getvar::mood}}.'),
  ];
  const shown = messages.map(({ id }) => ({ message: `message-${id}`, version: id }));
  const chatScope = (over: Partial<PromptInput['scope']> = {}) => scope({ messages, greeting: null, ...over });
  const read = (): ChatRead => ({ shown, roles: messages.map(({ role }) => role), speakers: speakersOf(chatScope()), texts: renderChat('prompt', chatScope()).texts });
  const record = (id: string, indices: number[], what: string, over: Partial<MemoryRecord> = {}): MemoryRecord => ({
    id,
    sources: indices.map((index) => shown[index]!),
    print: printOf(read(), indices),
    when: null,
    where: 'the lighthouse',
    who: ['Luna', 'jin'],
    what,
    lines: [],
    outcome: '',
    state: [],
    opens: [],
    closes: [],
    receipt: null,
    at: 0,
    ...over,
  });
  const memoryOf = (records: MemoryRecord[]): Memory => ({ records, chapters: [], state: [{ about: 'Luna', field: 'mood', value: 'wary', record: null }], threads: [{ id: 't1', text: 'jin will come back.', opened: null }] });
  const withMemory = (memory: Memory, budget = 25_000, over: Partial<PromptInput['scope']> = {}, found: string[] = []): Assembled =>
    assembledOf(assemble({ scope: chatScope(over), seed: 'reply-1', countTokens: (text) => text.length, budget: null, tools: [], continuing: false, memory: { kind: 'built-in', memory, budget, shown, found } }));
  const chatOf = (result: Assembled) => result.messages.filter((_, index) => result.parts[index]!.from.kind === 'block' && (result.parts[index]!.from as { slot: string }).slot === 'chat').map(({ content }) => content);
  const memoryOfSent = (result: Assembled) => result.messages.find((_, index) => (result.parts[index]!.from as { slot?: string }).slot === 'memory');

  it('sends the covered messages as memory in its slot, leaves them out of the chat but replays their variables, and anchors a cache point before it', () => {
    const result = withMemory(memoryOf([record('r1', [0, 1], 'jin and Luna reach the lighthouse.'), record('r2', [2, 3], 'jin promises to come back.')]));
    expect(result.memory).toEqual({ by: null, sent: ['r1', 'r2'], covered: 4, missing: 0, slot: true, found: [] });
    expect(chatOf(result)).toEqual(['Morning comes.', 'Luna is calm.']);
    const sent = memoryOfSent(result)!;
    expect(sent.content).toContain('- Luna, mood: wary');
    expect(sent.content.indexOf('jin and Luna reach')).toBeLessThan(sent.content.indexOf('jin promises'));
    const at = result.messages.indexOf(sent);
    expect(result.messages[at - 1]).toEqual({ role: 'system', content: '# Material 3: Past Events/Prelude Summary', cache: true });
  });

  it('puts the records retrieval found before the latest user message, a sent one as its messages word for word, and nothing when none was found', () => {
    const memory = memoryOf([record('r1', [0, 1], 'jin and Luna reach the lighthouse.'), record('r2', [2, 3], 'jin promises to come back.')]);
    const result = withMemory(memory, 25_000, {}, ['r2']);
    expect(result.memory).toEqual({ by: null, sent: ['r1', 'r2'], found: ['r2'], covered: 4, missing: 0, slot: true });
    const at = result.parts.findIndex(({ from }) => from.kind === 'retrieval');
    expect(result.messages[at]).toEqual({ role: 'user', content: `${RETRIEVED_HEADING}\n\n[When: unknown · Where: the lighthouse · Present: Luna, jin]\nThe messages, word for word:\njin: I promise to come back.\nLuna: Luna nods.` });
    expect(result.messages.slice(at + 1).map(({ content }) => content)).toEqual(['Morning comes.', 'Luna is calm.']);
    expect(withMemory(memory, 25_000, {}, []).parts.some(({ from }) => from.kind === 'retrieval')).toBe(false);
  });

  it('sends the same memory text on the next turn while nothing is committed, so the cache before and through it holds', () => {
    const memory = memoryOf([record('r1', [0, 1], 'jin and Luna reach the lighthouse.'), record('r2', [2, 3], 'jin promises to come back.')]);
    const next = [...messages, message('m6', 'user', 'Rain again.'), message('m7', 'assistant', 'Luna lights the lamp at {{time}}.')];
    const turns = [withMemory(memory), withMemory(memory, 25_000, { messages: next, clock: { now: Date.UTC(2026, 9, 1, 12), timeZone: 'UTC' } })];
    const [first, second] = turns.map((turn) => {
      const at = turn.messages.indexOf(memoryOfSent(turn)!);
      return turn.messages.slice(0, at + 1);
    });
    expect(second).toEqual(first);
    expect(first!.at(-2)!.cache).toBe(true);
  });

  it('sends pinned records always and the newest that fit, holds back stale and forgotten ones, and counts the messages left with no memory', () => {
    const long = 'Luna tells the whole history of the lighthouse. '.repeat(20);
    const result = withMemory(
      memoryOf([
        record('r1', [0], 'They arrive.', { pinned: true }),
        record('r2', [1], long),
        record('r3', [2], 'jin promises.', { print: 'rendered before' }),
        record('r4', [3], 'Luna nods.', { forgotten: true }),
        record('r5', [4], 'Morning.'),
      ]),
      400,
    );
    expect(result.memory).toEqual({ by: null, sent: ['r1', 'r5'], covered: 5, missing: 3, slot: true, found: [] });
    expect(chatOf(result)).toEqual(['Luna is calm.']);
    expect(memoryOfSent(result)!.content).toMatch(/^Current state:\n- Luna, mood: wary\n\nOpen threads:\n- jin will come back\./);
    const pinned = withMemory(memoryOf([record('r1', [0], 'They arrive.', { print: 'rendered before', pinned: true })]));
    expect(pinned.memory).toMatchObject({ sent: ['r1'], missing: 0 });
  });

  it('counts every covered message as missing when the prompt has no 장기 기억 slot or a toggle leaves it out, and sends nothing for an empty memory', () => {
    const memory = memoryOf([record('r1', [0, 1], 'They arrive.')]);
    const without = withMemory(memory, 25_000, { prompt: { ...starter, blocks: starter.blocks.filter(({ id }) => id !== 'memory') } });
    expect(without.memory).toEqual({ by: null, sent: ['r1'], covered: 2, missing: 2, slot: false, found: [] });
    expect(chatOf(without)).toHaveLength(4);
    const toggled = {
      ...starter,
      blocks: starter.blocks.map((block) => (block.id === 'memory' ? { ...block, wrapper: '{{#if {{getglobalvar::toggle_sims}}}}{{slot}}{{/if}}' } : block)),
    } as Prompt & { task?: never };
    const off = withMemory(memory, 25_000, { prompt: toggled, toggles: new Map([['sims', '0']]) });
    expect([off.memory, memoryOfSent(off)]).toEqual([{ by: null, sent: ['r1'], covered: 2, missing: 2, slot: false, found: [] }, undefined]);
    const empty = withMemory({ records: [], chapters: [], state: [], threads: [] });
    expect([empty.memory, memoryOfSent(empty), chatOf(empty)]).toEqual([{ by: null, sent: [], covered: 0, missing: 0, slot: true, found: [] }, undefined, messages.map(() => expect.any(String))]);
  });

  it("sends a tool's memory in the slot's own place, leaves out the messages through the one it names, and cuts nothing where the slot does not reach", () => {
    const told = (text: string, through: number, over: Partial<PromptInput['scope']> = {}) =>
      assembledOf(assemble({ scope: chatScope(over), seed: 'reply-1', countTokens: (each) => each.length, budget: null, tools: [], continuing: false, memory: { kind: 'tool', name: '기억', text, through } }));
    const result = told('Luna waits at the lighthouse.', 3);
    expect(result.memory).toEqual({ by: '기억', text: 'Luna waits at the lighthouse.', covered: 4, missing: 0, slot: true });
    expect(chatOf(result)).toEqual(['Morning comes.', 'Luna is calm.']);
    const sent = memoryOfSent(result)!;
    expect(sent.content).toBe('Luna waits at the lighthouse.');
    expect(result.messages[result.messages.indexOf(sent) - 1]!.cache).toBe(true);
    const without = told('Luna waits.', 3, { prompt: { ...starter, blocks: starter.blocks.filter(({ id }) => id !== 'memory') } });
    expect([without.memory, memoryOfSent(without), chatOf(without)]).toEqual([{ by: '기억', text: 'Luna waits.', covered: 0, missing: 0, slot: false }, undefined, messages.map(() => expect.any(String))]);
    expect(chatOf(told('', 3))).toHaveLength(messages.length);
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

  it('skips the input and output stages on a text already past them, as on the greeting, and runs them on one written here', () => {
    const regex = [script('output', 'nods', 'smiles'), script('input', 'Good', 'Fine')];
    const staged = (each: HistoryMessage): HistoryMessage => ({ ...each, staged: true });
    const messages = [staged(message('a1', 'assistant', 'She nods.')), staged(message('u1', 'user', 'Good.')), message('a2', 'assistant', 'She nods.'), message('u2', 'user', 'Good.')];
    expect(renderChat('prompt', scope({ card: card({ regex, greetings: [] }), messages, greeting: null })).texts).toEqual(['She nods.', 'Good.', 'She smiles.', 'Fine.']);
  });

  it("starts from the chat's own variables over the card's defaults", () => {
    const over = { card: card({ variables: [['count', '0'], ['mood', 'calm']], greetings: [] }), messages: [message('u1', 'user', '{{getvar::count}} {{getvar::mood}}')], greeting: null };
    expect(renderChat('prompt', scope({ ...over, variables: [['count', '5']] })).texts).toEqual(['5 calm']);
  });

  it("sets the bot's Lua writes around a message's own text, and those for the reply being made after the last", () => {
    const messages = [
      { ...message('u1', 'user', '{{getvar::turn}}{{setvar::turn::typed}}'), before: [['turn', 'lua']] as [string, string][], after: [['hp', '9']] as [string, string][] },
      message('a1', 'assistant', '{{getvar::turn}} {{getvar::hp}}'),
    ];
    const rendered = renderChat('prompt', scope({ card: card({ greetings: [] }), messages, greeting: null, pending: [['turn', 'next']] }));
    expect(rendered.texts).toEqual(['lua', 'typed 9']);
    expect(rendered.staged).toEqual(['lua', 'typed 9']);
    expect(rendered.variables.get('turn')).toBe('next');
  });

  it('rolls a random tag in a message the same on screen as in the prompt', () => {
    const over = { card: card({ greetings: [] }), messages, greeting: null };
    expect(renderChat('display', scope(over)).texts[2]).toBe(renderChat('prompt', scope(over)).texts[2]);
    expect(renderChat('prompt', scope(over)).texts[2]).toMatch(/^She nods\. \d+$/);
  });
});

describe('unused', () => {
  it('counts what chats do not use yet', () => {
    expect(unused(card({ bias: [['a', 1]], utility: true }))).toEqual([
      { kind: 'bias', count: 1 },
      { kind: 'utility', count: 1 },
    ]);
  });
});

describe('a request a script rewrote', () => {
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

  it('keeps the parts of the messages left as built, counts the script’s own, and holds the budget by the oldest chat messages', () => {
    const edited = [built[0]!, built[1]!, note, built[2]!, built[3]!];
    expect(rewritten(prompt, edited, count, null)).toEqual({ ...prompt, messages: edited, parts: [prompt.parts[0], prompt.parts[1], { from: { kind: 'script' }, tokens: 15 }, prompt.parts[2], prompt.parts[3]] });
    expect(rewritten(prompt, edited, count, 50)).toMatchObject({ messages: [built[0], note, built[2], built[3]], dropped: 3 });
    expect(rewritten(prompt, edited, count, 30)).toEqual({ kind: 'too-long', tokens: 38, budget: 30 });
  });
});

describe('tool prompt text', () => {
  const tools = [{ module: 'a', name: 'Notes', text: 'one {{getvar::untouched}}' }, { module: 'b', name: 'Memory', text: 'two' }];
  const chat = { id: 'chat', name: null, kind: 'slot' as const, slot: 'chat' as const, range: { from: 0, to: null } };

  it('fills an explicit slot in pack order with provenance and without evaluating tool text', () => {
    const base = input();
    const prompt = { ...base.scope.prompt, blocks: [{ id: 'tool', name: null, kind: 'slot' as const, slot: 'tool' as const, role: 'system' as const, wrapper: '<tools>{{slot}}</tools>' }, chat] };
    const built = assembledOf(assemble({ ...base, scope: { ...base.scope, prompt }, tools }));
    expect(built.messages[0]).toMatchObject({ role: 'system', content: '<tools>one {{getvar::untouched}}\n\ntwo</tools>' });
    expect(built.parts[0]!.from).toEqual({ kind: 'tool', name: 'Notes · Memory' });
  });

  it('places implicit text after the template, preserving the history prefix across tool changes', () => {
    const base = input();
    const prompt = { ...base.scope.prompt, blocks: [{ id: 'top', name: null, kind: 'text' as const, role: 'system' as const, text: 'top', mark: null }, chat, { ...chat, id: 'again' }] };
    const built = assembledOf(assemble({ ...base, scope: { ...base.scope, prompt }, tools }));
    expect(built.messages[0]!.content).toBe('top');
    expect(built.messages.at(-1)).toMatchObject({ role: 'system', content: 'one {{getvar::untouched}}\n\ntwo' });
    const next = assembledOf(assemble({ ...base, scope: { ...base.scope, prompt }, tools: [{ ...tools[0]!, text: 'new turn' }] }));
    expect(next.messages.slice(0, -1)).toEqual(built.messages.slice(0, -1));
    const continued = assembledOf(assemble({ ...base, scope: { ...base.scope, prompt }, tools, continuing: true }));
    expect(continued.messages.at(-2)).toEqual(built.messages.at(-1));
    expect(continued.parts.at(-1)!.from).toEqual({ kind: 'continue' });
    expect(built.parts.filter(({ from }) => from.kind === 'tool')).toHaveLength(1);
  });

  it('adds no message for blank tool answers', () => {
    const base = input();
    const built = assembledOf(assemble({ ...base, tools: [{ module: 'a', name: 'empty', text: '  ' }] }));
    expect(built.messages).toEqual(assembledOf(assemble(base)).messages);
    expect(built.parts.some(({ from }) => from.kind === 'tool')).toBe(false);
  });
});
