import { describe, expect, it } from 'vitest';
import type { HistoryMessage } from '../history';
import type { LoreEntry } from '../import/types';
import { prepareLore, type Activation, type LoreInput } from './activate';

const NULLS = { scanDepth: null, tokenBudget: null, recursive: null, fullWordMatching: null };

const lore = (id: string, value: Partial<Omit<LoreEntry, 'folder'>>) => ({
  id,
  value: {
    name: id,
    keys: [],
    secondaryKeys: [],
    content: id,
    enabled: true,
    constant: false,
    selective: false,
    useRegex: false,
    caseSensitive: false,
    insertionOrder: 100,
    priority: null,
    position: null,
    ...value,
  },
});
const chat = (...texts: string[]): HistoryMessage[] => texts.map((text, i) => ({ id: `m${i}`, seed: `m${i}`, role: i % 2 ? 'assistant' : 'user', text, time: null }));
const run = (entries: LoreInput['entries'], history: HistoryMessage[], more: Partial<LoreInput> = {}) =>
  prepareLore(entries, more.settings ?? NULLS).activate({ history, end: history.length, turn: history.length + 1, greeting: 0, afterMatch: [], seed: 'send', cost: (_, body) => body.length, ...more });
const order = (activation: Activation) => activation.placed.map(({ id }) => id);
const ids = (activation: Activation) => order(activation).sort();
const why = (activation: Activation, id: string) => activation.fired.find((fired) => fired.id === id)?.why;

describe('activate', () => {
  it('honors enabled: false and fires constant entries without keys (row 5a)', () => {
    const result = run([lore('always', { constant: true }), lore('off', { constant: true, enabled: false }), lore('keyless', {})], chat('hi'));
    expect(result.fired).toEqual([{ id: 'always', why: { kind: 'constant' }, fate: { kind: 'placed', tokens: 6 } }]);
  });

  it('matches plain keys in any case unless the entry is case-sensitive (row 5b), ignoring spacing and CBS comments', () => {
    const entries = [lore('any', { keys: ['Red Dragon'] }), lore('exact', { keys: ['Red Dragon'], caseSensitive: true }), lore('comment', { keys: ['secret'] })];
    expect(ids(run(entries, chat('a reddragon {{// secret}} {{comment::secret}}')))).toEqual(['any']);
    expect(ids(run(entries, chat('the Red  Dragon')))).toEqual(['any', 'exact']);
  });

  it('matches whole words at letter and digit boundaries in full-word mode, per entry', () => {
    const settings = { ...NULLS, fullWordMatching: true };
    const entries = [
      lore('word', { keys: ['cat'] }),
      lore('exact', { keys: ['cat'], caseSensitive: true }),
      lore('phrase', { keys: ['old  man'] }),
      lore('partial', { keys: ['cat'], content: '@@match_partial_word\npartial' }),
    ];
    expect(ids(run(entries, chat('"Cat!" said the old\nman.'), { settings }))).toEqual(['partial', 'phrase', 'word']);
    expect(ids(run(entries, chat('concatenate'), { settings }))).toEqual(['partial']);
    expect(ids(run(entries, chat('a cat'), { settings }))).toEqual(['exact', 'partial', 'word']);
  });

  it('compiles regex keys as written, mixed with plain keys, and reports those that do not compile (row 2)', () => {
    const entries = [
      lore('regex', { useRegex: true, keys: ['/drag(o|oo)n/', 'castle'] }),
      lore('flags', { useRegex: true, keys: ['/^the KING$/mi'] }),
      lore('cased', { useRegex: true, keys: ['/DRAGOON/'] }),
      lore('broken', { useRegex: true, keys: ['/(/', '/unclosed', 'moat'] }),
    ];
    const result = run(entries, chat('a dragoon\nThe King'));
    expect(ids(result)).toEqual(['flags', 'regex']);
    expect(result.invalidKeys).toEqual([
      { entry: 'broken', key: '/(/' },
      { entry: 'broken', key: '/unclosed' },
    ]);
    expect(ids(run(entries, chat('the moat by the castle')))).toEqual(['broken', 'regex']);
  });

  it('needs a secondary key when selective, every @@additional_keys line, and no @@exclude_keys key, and says where each matched', () => {
    const entries = [
      lore('selective', { keys: ['sword'], secondaryKeys: ['fire'], selective: true }),
      lore('additional', { keys: ['sword'], content: '@@additional_keys fire\n@@additional_keys ice, frost\nadditional' }),
      lore('exclude', { keys: ['sword'], content: '@@exclude_keys ice,water\nexclude' }),
    ];
    expect(ids(run(entries, chat('a sword', 'of fire')))).toEqual(['exclude', 'selective']);
    const frost = run(entries, chat('a sword', 'of fire and frost'));
    expect(ids(frost)).toEqual(['additional', 'exclude', 'selective']);
    expect(why(frost, 'additional')).toEqual({
      kind: 'keys',
      matched: [
        { query: 'primary', key: 'sword', source: { kind: 'message', id: 'm0' } },
        { query: 'additional', key: 'fire', source: { kind: 'message', id: 'm1' } },
        { query: 'additional', key: 'frost', source: { kind: 'message', id: 'm1' } },
      ],
    });
    expect(ids(run(entries, chat('a sword of fire and ice')))).toEqual(['additional', 'selective']);
  });

  it('excludes on @@exclude_keys_all when every key appears anywhere in the scanned text (row 4)', () => {
    const entries = [lore('guard', { keys: ['gate'], content: '@@exclude_keys_all night,rain\nguard' })];
    expect(ids(run(entries, chat('the gate at night', 'rain falls')))).toEqual([]);
    expect(ids(run(entries, chat('the gate at night')))).toEqual(['guard']);
  });

  it("scans the last scanDepth messages, 5 by default, or the entry's own @@scan_depth", () => {
    const history = chat('dragon', 'one', 'two', 'three', 'four', 'five');
    const entries = [
      lore('default', { keys: ['dragon'] }),
      lore('deep', { keys: ['dragon'], content: '@@scan_depth 6\ndeep' }),
      lore('none', { keys: ['five'], content: '@@scan_depth 0\nnone' }),
    ];
    expect(ids(run(entries, history))).toEqual(['deep']);
    expect(ids(run(entries, history, { settings: { ...NULLS, scanDepth: 6 } }))).toEqual(['deep', 'default']);
  });

  it('scans the bodies of fired entries in later passes and names the entry a key matched in', () => {
    const entries = [
      lore('castle', { keys: ['castle'], content: 'The castle has a moat.' }),
      lore('moat', { keys: ['moat'], content: 'The moat hides an eel.' }),
      lore('eel', { keys: ['eel'], content: '@@no_recursive_search\neel' }),
      lore('flat', { keys: ['castle'], content: '@@unrecursive\nThe castle has a tower.' }),
      lore('tower', { keys: ['tower'] }),
    ];
    const result = run(entries, chat('to the castle'));
    expect(ids(result)).toEqual(['castle', 'flat', 'moat']);
    expect(why(result, 'moat')).toEqual({ kind: 'keys', matched: [{ query: 'primary', key: 'moat', source: { kind: 'entry', id: 'castle' } }] });
    expect(ids(run(entries, chat('to the castle'), { settings: { ...NULLS, recursive: false } }))).toEqual(['castle', 'flat']);
  });

  it('rolls @@probability once per entry per send, so a later pass does not roll again (row 9)', () => {
    const entries = [lore('maybe', { keys: ['omen'], content: '@@probability 50\nmaybe' }), lore('echo', { keys: ['omen'], content: 'another omen' })];
    const lost = run(entries, chat('an omen'), { seed: 'send-2' });
    expect(ids(lost)).toEqual(['echo']);
    expect(lost.fired.filter(({ id }) => id === 'maybe').map(({ fate }) => fate)).toEqual([{ kind: 'dropped', cause: 'probability' }]);
    expect(ids(run(entries, chat('an omen'), { seed: 'send-1' }))).toEqual(['echo', 'maybe']);
  });

  it('keeps the after-match flags to their own entry, and remembers only entries that went in (row 8)', () => {
    const entries = [
      lore('sticky', { keys: ['bell'], content: '@@keep_activate_after_match\nsticky' }),
      lore('once', { keys: ['bell'], content: '@@dont_activate_after_match\nonce' }),
      lore('plain', { keys: ['bell'] }),
      lore('big', { keys: ['bell'], content: `@@keep_activate_after_match\n${'x'.repeat(900)}` }),
    ];
    const first = run(entries, chat('a bell'));
    expect(first.afterMatch.sort()).toEqual(['once', 'sticky']);
    const quiet = run(entries, chat('quiet'), { afterMatch: first.afterMatch });
    expect(ids(quiet)).toEqual(['sticky']);
    expect(why(quiet, 'sticky')).toEqual({ kind: 'decorator', name: 'keep_activate_after_match' });
    expect(ids(run(entries, chat('a bell'), { afterMatch: first.afterMatch }))).toEqual(['plain', 'sticky']);
  });

  it('prepares effective sticky entries once and scans only demanded messages across replay end indexes', () => {
    let reads = 0;
    const history = chat('bell', 'quiet', 'quiet', 'quiet').map((message) => ({ ...message, get text() { reads++; return message.text; } }));
    const entries = [lore('sticky', { keys: ['bell'], content: '@@scan_depth 3\n@@unknown\n@@@keep_activate_after_match\nsticky' })];
    const book = prepareLore(entries, { ...NULLS, scanDepth: 1 });
    const input = { history, turn: 3, greeting: null, afterMatch: [], seed: 'send', cost: (_: string, body: string) => body.length };
    const first = book.activate({ ...input, end: 3 });
    expect(book.sticky).toBe(true);
    expect(first.afterMatch).toEqual(['sticky']);
    expect(why(book.activate({ ...input, end: 4, turn: 4, afterMatch: first.afterMatch }), 'sticky')).toEqual({ kind: 'decorator', name: 'keep_activate_after_match' });
    expect(reads).toBe(3);
    expect(book.activate({ ...input, end: 3 }).fired).toEqual(first.fired);
    expect(reads).toBe(3);
    expect(prepareLore([{ ...entries[0]!, value: { ...entries[0]!.value, enabled: false } }], NULLS).sticky).toBe(false);
  });

  it('gates on the turn and the greeting, and fires @@activate without keys under the same gates', () => {
    const entries = [
      lore('late', { constant: true, content: '@@activate_only_after 4\nlate' }),
      lore('even', { content: '@@activate\n@@activate_only_every 2\neven' }),
      lore('second', { constant: true, content: '@@is_greeting 2\nsecond' }),
    ];
    expect(ids(run(entries, [], { turn: 3, greeting: 1 }))).toEqual(['second']);
    expect(ids(run(entries, [], { turn: 4, greeting: 0 }))).toEqual(['even', 'late']);
  });

  it('skips by priority what does not fit the budget, then lists by insertion order, ties last-fired first', () => {
    const entries = [
      lore('low', { constant: true, insertionOrder: 1, content: 'x'.repeat(50) }),
      lore('high', { constant: true, insertionOrder: 3, priority: 9, content: 'x'.repeat(60) }),
      lore('mid', { constant: true, insertionOrder: 2, content: `@@priority 5\n${'x'.repeat(30)}` }),
      lore('last', { constant: true, insertionOrder: 0, content: '@@ignore_on_max_context\nx' }),
    ];
    const result = run(entries, [], { settings: { ...NULLS, tokenBudget: 100 } });
    expect(order(result)).toEqual(['last', 'mid', 'high']);
    expect(result.fired.find(({ id }) => id === 'low')?.fate).toEqual({ kind: 'dropped', cause: 'budget', tokens: 50 });
    expect(order(run([lore('a', { constant: true }), lore('b', { constant: true })], []))).toEqual(['b', 'a']);
  });

  it('places bodies in the lorebook slot, around the description, at named positions and injection targets, trying @@@ fallbacks', () => {
    const entries = [
      lore('slot', { constant: true, content: '@@role assistant\nslot' }),
      lore('before', { constant: true, position: 'before_char' }),
      lore('after', { constant: true, position: 'before_char', content: '@@position scenario\nafter' }),
      lore('named', { constant: true, content: '@@position pt_status\nnamed' }),
      lore('inject', { constant: true, content: '@@inject_at main\n@@inject_replace {{slot}}\ninject' }),
      lore('fallback', { constant: true, content: '@@role narrator\n@@@role user\n@@disable_ui_prompt\n@@@depth 1\nfallback' }),
    ];
    const result = run(entries, []);
    expect(Object.fromEntries(result.placed.map(({ id, body, placement }) => [id, { body, placement }]))).toEqual({
      slot: { body: 'slot', placement: { kind: 'lorebook', role: 'assistant' } },
      before: { body: 'before', placement: { kind: 'description', side: 'before' } },
      after: { body: 'after', placement: { kind: 'description', side: 'after' } },
      named: { body: 'named', placement: { kind: 'position', name: 'status' } },
      inject: { body: 'inject', placement: { kind: 'inject', target: 'main', operation: { kind: 'replace', find: '{{slot}}' } } },
      fallback: { body: 'fallback', placement: { kind: 'depth', depth: 1, role: 'user' } },
    });
  });

  it("counts depth from the end, @@reverse_depth too, and lists one depth's entries in Risu's order (row 3)", () => {
    const entries = [
      lore('d1', { constant: true, insertionOrder: 1, content: '@@depth 2\nd1' }),
      lore('d2', { constant: true, insertionOrder: 2, content: '@@depth 2\nd2' }),
      lore('r1', { constant: true, insertionOrder: 3, content: '@@reverse_depth 2\nr1' }),
      lore('r2', { constant: true, insertionOrder: 4, content: '@@reverse_depth 2\nr2' }),
      lore('prefill', { constant: true, insertionOrder: 5, content: '@@depth 0\n@@role assistant\nprefill' }),
      lore('end', { constant: true, insertionOrder: 6, content: '@@end\nend' }),
      lore('r0', { constant: true, insertionOrder: 7, content: '@@reverse_depth 0\nr0' }),
    ];
    const result = run(entries, chat('hi'));
    expect(order(result)).toEqual(['r0', 'end', 'prefill', 'd2', 'd1', 'r1', 'r2']);
    expect(result.placed.map(({ placement }) => placement)).toEqual([
      { kind: 'depth', depth: 0, role: 'system' },
      { kind: 'depth', depth: 0, role: 'system' },
      { kind: 'depth', depth: 0, role: 'assistant' },
      ...Array.from({ length: 4 }, () => ({ kind: 'depth', depth: 2, role: 'system' })),
    ]);
  });

  it('merges @@inject_lore into the fired entry of that name, and reports one with no target or no text to replace', () => {
    const entries = [
      lore('target', { constant: true, name: 'Castle', content: 'The castle. [moat]' }),
      lore('add', { constant: true, insertionOrder: 1, content: '@@inject_lore Castle\nIt is old.' }),
      lore('swap', { constant: true, insertionOrder: 2, content: '@@inject_lore Castle\n@@inject_replace [moat]\nA moat.' }),
      lore('lost', { constant: true, content: '@@inject_lore Tower\nlost' }),
      lore('miss', { constant: true, insertionOrder: 3, content: '@@inject_lore Castle\n@@inject_replace [gate]\nmiss' }),
    ];
    const result = run(entries, []);
    expect(result.placed).toEqual([{ id: 'target', body: 'The castle. A moat. It is old.', placement: { kind: 'lorebook', role: 'system' } }]);
    expect(Object.fromEntries(result.fired.map(({ id, fate }) => [id, fate]))).toEqual({
      target: { kind: 'placed', tokens: 18 },
      add: { kind: 'merged', into: 'target', tokens: 10 },
      swap: { kind: 'merged', into: 'target', tokens: 7 },
      lost: { kind: 'dropped', cause: 'no-target', tokens: 4 },
      miss: { kind: 'dropped', cause: 'no-target', tokens: 4 },
    });
  });
});
