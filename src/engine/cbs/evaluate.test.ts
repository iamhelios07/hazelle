import { describe, expect, it } from 'vitest';
import type { HistoryMessage } from '../history';
import type { Card } from '../import/types';
import { unescapeCbs } from './escape';
import { evaluate, type CbsContext } from './evaluate';

const card = (over: Partial<Card> = {}): Card => ({
  name: 'Luna',
  nickname: null,
  description: '',
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

const message = (id: string, role: HistoryMessage['role'], text: string): HistoryMessage => ({ id, seed: id, role, text, time: null });

const context = (over: Partial<CbsContext> = {}): CbsContext => ({
  stage: 'prompt',
  card: card(),
  persona: { name: 'jin', description: '' },
  prompt: { main: '', globalNote: '', authorNote: '' },
  lore: [],
  messages: [message('v1', 'assistant', 'Hello')],
  source: { seed: 'request-1' },
  greeting: { index: 0 },
  variables: new Map(),
  toggle: () => null,
  model: { id: 'model', maxContext: null, prefill: null },
  screen: null,
  clock: { now: Date.UTC(2026, 8, 28, 5, 4, 3), timeZone: 'UTC' },
  pickSeed: 'pick-1',
  ...over,
});
const run = (text: string, over: Partial<CbsContext> = {}) => evaluate(text, context(over));
const inMessage = { source: { message: 0 } };

describe('evaluate', () => {
  it('reads names without case, spaces, _ or -, and splits at a single colon when the first colon is single', () => {
    expect(run('{{Get_Var:mood}} {{ USER }}', { variables: new Map([['mood', 'calm']]) })).toBe('calm jin');
  });

  it('reads <user>, <char> and <bot> as the tags', () => {
    expect(run('<USER> meets <char> and <Bot>')).toBe('jin meets Luna and Luna');
  });

  it('leaves an unknown or unsupported tag as written with its inner tags evaluated, and {{char}} with no character', () => {
    expect(run('{{img::{{user}}.png}} {{nope}} {{jb}}')).toBe('{{img::jin.png}} {{nope}} {{jb}}');
    expect(run('{{char}}', { card: null })).toBe('{{char}}');
  });

  it('re-emits an unclosed tag or block as written and evaluates the tags after it', () => {
    expect(run('a {{ b {{user}}')).toBe('a {{ b jin');
    expect(run('{{#if 1}}x {{user}}')).toBe('{{#if 1}}x jin');
  });

  it('evaluates only the #when branch it takes', () => {
    const variables = new Map<string, string>();
    expect(run('{{#when::0}}{{setvar::a::1}}yes{{:else}}{{setvar::b::1}}no{{/when}}', { ...inMessage, variables })).toBe('no');
    expect([...variables]).toEqual([['b', '1']]);
  });

  it('folds #when operators right to left over variables and toggles', () => {
    const over = { variables: new Map([['hp', '3'], ['met', 'true']]), toggle: (key: string) => ({ nsfw: '1', mode: '2' })[key] ?? null };
    const holds = (condition: string) => run(`{{#when::${condition}}}y{{:else}}n{{/when}}`, over);
    expect(['not::1::and::0', 'var::met', 'hp::vis::3', 'toggle::nsfw', 'mode::tis::2', '3::>::2', 'var::none', 'a::b'].map(holds)).toEqual(['y', 'y', 'y', 'y', 'y', 'y', 'n', 'n']);
    expect(run('{{#when 1}}y{{/when}}')).toBe('y');
  });

  it('trims the blank lines around a #when branch unless keep, and keeps what inner tags output', () => {
    expect(run('{{#when::1}}\n  yes\n{{:else}}\nno\n{{/when}}')).toBe('  yes');
    expect(run('{{#when::keep::1}}\nyes\n{{/when}}')).toBe('\nyes\n');
    expect(run('{{#when::1}}{{br}}yes{{/when}}')).toBe('\nyes');
  });

  it('trims each line of a true #if, leaves a false one unevaluated, and keeps whitespace in #if_pure', () => {
    const variables = new Map<string, string>();
    expect(run('{{#if 1}}\n  a\n  b\n{{/if}}|{{#if 0}}{{setvar::x::1}}{{/if}}|{{#if_pure true}} c {{/if_pure}}', { ...inMessage, variables })).toBe('a\nb|| c ');
    expect(variables.size).toBe(0);
  });

  it('repeats #each per item of a JSON or § array, each item rolling its own random tags', () => {
    expect(run('{{#each ["a","b"] as x}}[{{slot::x}}]{{/each}} {{#each 1§2 y}}{{slot::y}}{{/each}}')).toBe('[a][b] 12');
    expect(run('[{{#each {{getvar::none}} as x}}{{slot::x}}{{/each}}]')).toBe('[]');
    const rolls = run('{{#each [1,2,3] as n}}{{randint::1::1000000}},{{/each}}').split(',').slice(0, 3);
    expect(new Set(rolls).size).toBe(3);
  });

  it('keeps escaped text through a later pass, and unescapes {{<}} to the character itself', () => {
    const once = run('{{#escape}}{{user}}(){{/escape}} {{<}}b{{>}} {{#puredisplay}}{{char}}{{/puredisplay}}');
    expect(unescapeCbs(run(once))).toBe('{{user}}() <b> {{char}}');
    expect(run('{{#pure}}{{user}}{{/pure}}')).toBe('{{user}}');
  });

  it('calls a #func with its arguments, ends a call at {{return}}, and stops recursion at the limit', () => {
    expect(run('{{#func greet}}\nHi {{arg::1}}\n{{/func}}{{call::greet::Bo}}')).toBe('Hi Bo');
    expect(run('{{#func test}}{{#if {{arg::1}}}}{{return::yes}}{{/if}}no{{/func}}{{call::test::1}}/{{call::test::0}}')).toBe('yes/no');
    expect(run('{{#func loop}}{{call::loop}}{{/func}}{{iserror::{{call::loop}}}}')).toBe('1');
  });

  it('drops {{//…}} in the prompt and leaves it in display', () => {
    expect(run('a{{// note: x}}b')).toBe('ab');
    expect(run('a{{// note}}b', { stage: 'display' })).toBe('a{{// note}}b');
  });

  it('writes variables from a chat message only, reads an unset one as empty, and adds to it from 0', () => {
    const variables = new Map([['hp', '10']]);
    const text = '{{setvar::mood::calm}}{{addvar::hp::5}}{{addvar::gold::3}}{{setdefaultvar::mood::angry}}{{setdefaultvar::name::Bo}}[{{getvar::mood}}{{getvar::none}}]';
    expect(run(text, { ...inMessage, variables })).toBe('[calm]');
    expect(Object.fromEntries(variables)).toEqual({ hp: '15', mood: 'calm', gold: '3', name: 'Bo' });

    const unchanged = new Map(variables);
    expect(run('{{setvar::mood::x}}{{description}}.', { variables: unchanged, card: card({ description: '{{setvar::hp::0}}d' }) })).toBe('d.');
    expect(run('{{description}}', { ...inMessage, variables: unchanged, card: card({ description: '{{setvar::hp::0}}d' }) })).toBe('d');
    expect(unchanged).toEqual(variables);
  });

  it('reads a toggle as the global variable toggle_<key>, and every other global variable as unset', () => {
    expect(run('[{{getglobalvar::toggle_nsfw}}|{{getglobalvar::other}}|{{getglobalvar::toggle_none}}]', { toggle: (key) => (key === 'nsfw' ? '1' : null) })).toBe('[1||]');
  });

  it('rolls a message random tag by its version and place, text outside messages by the request, and pick by its own seed', () => {
    const rolls = '{{randint::1::1000000}} {{randint::1::1000000}}';
    const [first, second] = run(rolls, inMessage).split(' ');
    expect(first).not.toBe(second);
    expect(run(rolls, { ...inMessage, stage: 'display' })).toBe(run(rolls, inMessage));
    expect(run(rolls, { ...inMessage, messages: [message('v2', 'assistant', 'Hello')] })).not.toBe(run(rolls, inMessage));
    expect(run(rolls, { source: { seed: 'request-2' } })).not.toBe(run(rolls));

    const picks = '{{pick::[1,2,3,4,5,6,7,8,9,10]}} {{pick::[1,2,3,4,5,6,7,8,9,10]}}';
    const [a, b] = run(picks).split(' ');
    expect(a).toBe(b);
    expect(run(picks, { source: { seed: 'request-2' } })).toBe(run(picks));
  });

  it('rolls XdY, dY or Y, and 1d6 for {{roll}} with no argument', () => {
    const rolls = (text: string) => Array.from({ length: 40 }, (_, i) => Number(run(text, { source: { seed: `r${i}` } })));
    const within = (all: number[], low: number, high: number) => all.every((n) => Number.isInteger(n) && n >= low && n <= high) && new Set(all).size > 1;
    expect(within(rolls('{{roll}}'), 1, 6)).toBe(true);
    expect(within(rolls('{{roll::20}}'), 1, 20)).toBe(true);
    expect(within(rolls('{{dice::3d4}}'), 3, 12)).toBe(true);
  });

  it('reads a date or time timestamp argument as seconds, in the clock time zone', () => {
    expect(run('{{date::YYYY-MM-DD HH:mm::1700000000}}', { clock: { now: 0, timeZone: 'Asia/Seoul' } })).toBe('2023-11-15 07:13');
    expect(run('{{time}} {{date}} {{unixtime}}')).toBe('5:4:3 2026-9-28 1790571843');
  });

  it('reads {{? …}} as calc with $name from the chat variables, and leaves an expression it cannot read as written', () => {
    expect(run('{{? $hp * 2 + 1}} {{calc::2 + abc}}', { variables: new Map([['hp', '4']]) })).toBe('9 {{calc::2 + abc}}');
  });

  it('numbers messages as Risu does: the greeting -1 and the message after it 0, or from 0 with no greeting', () => {
    const messages = [message('g', 'assistant', 'Hello'), message('u', 'user', 'hi'), message('a', 'assistant', 'yo')];
    const tags = '{{chatindex}} {{isfirstmsg}} {{firstmsgindex}} {{role}} {{previouscharchat}} {{previoususerchat}} {{lastmessageid}} {{previouschatlog::-1}} {{previouschatlog::0}}';
    expect(run(tags, { messages, greeting: { index: 1 }, source: { message: 2 } })).toBe('1 0 1 char Hello hi 1 Hello hi');
    expect(run('{{chatindex}} {{isfirstmsg}} {{role}}', { messages, source: { message: 0 } })).toBe('-1 1 char');
    expect(run('{{chatindex}} {{isfirstmsg}}', { messages })).toBe('{{chatindex}} 0');
    const plain = messages.slice(1);
    expect(run('{{chatindex}} {{lastmessageid}} {{previouschatlog::0}} {{previouschatlog::-1}} {{firstmsgindex}}', { messages: plain, greeting: null, source: { message: 1 } })).toBe(
      '1 1 hi Out of range {{firstmsgindex}}',
    );
  });

  it('escapes :: inside an array, and spreads an array into the arguments of the tag around it', () => {
    expect(run('{{arrayelement::{{history}}::1}}', { messages: [message('g', 'assistant', 'a'), message('u', 'user', 'k::v')] })).toBe('k::v');
    expect(run('{{equal::{{spread::["x","x"]}}}}')).toBe('1');
  });

  it('leaves a tag with an argument out of range as written', () => {
    expect(run('{{fixnum::1.5::200}} {{date::YYYY::soon}}')).toBe('{{fixnum::1.5::200}} {{date::YYYY::soon}}');
  });
});
