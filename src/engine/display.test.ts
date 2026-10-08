import { describe, expect, it } from 'vitest';
import { resolveAssets } from './assets';
import { evaluate } from './cbs/evaluate';
import { display, DisplayPass, storyHtml } from './display';
import type { HistoryMessage } from './history';
import type { Card } from './import/types';
import { onProgress } from './progress';
import { contexts, type ChatScope, type LuaDisplay } from './render';

const card: Card = {
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
  triggers: [],
  regex: [
    { name: 'hp', find: '\\[HP (\\d+)\\]', replace: '{{setvar::hp::$1}}<style>.x-risu-box { color: red }</style><div class="box">HP $1</div>', stage: 'output', flags: null },
    { name: 'box', find: 'BOX', replace: '<style>.x-risu-box { color: red }</style><div class="box">box</div>', stage: 'display', flags: null },
  ],
  background: '<style>.hp::after { content: "{{getvar::hp}}" }',
  loreSettings: { scanDepth: null, tokenBudget: null, recursive: null, fullWordMatching: null },
};
const message = (id: string, role: HistoryMessage['role'], text: string): HistoryMessage => ({ id, seed: id, role, text, time: null });
const scope: ChatScope = {
  card,
  cast: [],
  packs: [card],
  persona: { name: 'jin', description: '' },
  prompt: null,
  note: null,
  lore: [],
  messages: [message('a1', 'assistant', 'BOX'), message('a2', 'assistant', 'The lamp. [HP 7]')],
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

describe('display', () => {
  it('takes every <style>, one left open too, out of the texts into one stylesheet for the chat, the backgroundHTML’s first, read with the last variables', () => {
    const { texts, css } = display(scope);
    expect(texts).toEqual(['<div class="box">box</div>\n', 'The lamp. <div class="box">HP 7</div>\n']);
    expect(css.split('\n')).toEqual(['.hp::after { content: "7" }', '.x-risu-box { color: red }']);
  });
});

describe('a message whose commands ran away', () => {
  it('shows as stored, its tags as written, and says the display stopped them', () => {
    const runaway = '{{settempvar::x::ab}}' + '{{settempvar::x::{{gettempvar::x}}{{gettempvar::x}}}}'.repeat(24);
    const shown = display({ ...scope, messages: [message('a1', 'assistant', runaway), message('a2', 'assistant', 'The lamp.')] });
    expect(shown.texts).toEqual([runaway, 'The lamp.']);
    expect(shown.stopped).not.toBeNull();
  });
});

describe('the editDisplay pass', () => {
  it('stamps each message with the variables the chat starts from, so a pass run from other ones is not fresh', () => {
    const stamps = (variables: [string, string][]) => {
      const seen: string[] = [];
      display({ ...scope, variables }, undefined, (_version, _text, stamp) => (seen.push(stamp), null));
      return seen;
    };
    expect(stamps([['mood', 'calm']])).toEqual(stamps([['mood', 'calm']]));
    expect(stamps([['mood', 'calm']])).not.toEqual(stamps([['mood', 'angry']]));
  });
});

it('gives a sign of life per stage of each message, and per row a Lua pass patches', () => {
  let signs = 0;
  onProgress(() => signs++);
  try {
    const pass = new DisplayPass({ ...scope, messages: [message('a', 'user', 'one'), message('b', 'assistant', 'two')] }, new Set(), () => null);
    expect(signs).toBe(4);
    pass.patch([{ version: 'b', text: 'done' }]);
    expect(signs).toBe(5);
  } finally {
    onProgress(() => {});
  }
});

it('finishes newest-first Lua patches like a full display, including variable history, boxes and CSS order', () => {
  const changed: ChatScope = { ...scope, messages: [
    { ...message('a', 'assistant', '{{setvar::hp::7}}BOX'), after: [['hp', '8']] },
    message('b', 'assistant', '{{setvar::hp::9}}BOX'),
  ] };
  const runaway = '{{settempvar::x::ab}}' + '{{settempvar::x::{{gettempvar::x}}{{gettempvar::x}}}}'.repeat(24);
  const values = new Map<string, string>([['b', runaway]]);
  const complete = new Set<string>();
  const lua: LuaDisplay = (id) => values.has(id) ? { text: values.get(id)!, fresh: complete.has(id) } : null;
  const take = new Set([1]);
  const pass = new DisplayPass(changed, take, lua);
  expect(pass.value.stopped).not.toBeNull();
  for (const [version, text] of [['b', '<style>.last { color: blue }</style>BOX {{getvar::hp}}'], ['a', '<style>.first { color: red }</style>BOX {{getvar::hp}}']]) {
    values.set(version!, text!);
    complete.add(version!);
    pass.patch([{ version: version!, text: text! }]);
    expect(pass.value).toEqual(display(changed, take, lua));
  }
  expect(pass.value.texts[0]).toContain('8');
  expect(pass.value.texts[1]).toContain('9');
  expect(pass.value.pass).toBe(false);
  expect(pass.value.stopped).toBeNull();
});

describe('asset tags', () => {
  const smile = '11111111-1111-4111-8111-111111111111';
  const wave = '22222222-2222-4222-8222-222222222222';
  const withAssets: ChatScope = { ...scope, assets: [{ id: smile, name: 'Smile.png' }, { id: wave, name: 'wave' }], faces: { char: 'data:char', user: null } };
  const run = (text: string, stage: 'display' | 'prompt') => evaluate(text, contexts(withAssets, stage, null)({ seed: 's' }, new Map()));

  it('show a picture by name in any case, or the nearest name, on screen only, and list the names everywhere', () => {
    expect(run('{{img::smile.png}}|{{raw::smiling}}|{{image::none of these}}|{{source::char}}{{source::user}}', 'display')).toBe(
      `<img src="asset:${smile}">|asset:${smile}||data:char`,
    );
    expect(run('{{img::smile.png}} {{assetlist}}', 'prompt')).toBe('{{img::smile.png}} ["Smile.png","wave"]');
  });

  it('take the picture’s URL once the chat has it, and nothing before', () => {
    const shown = `<img src="asset:${smile}"><div style="background: url(asset:${wave})">`;
    expect(resolveAssets(shown, (id) => (id === smile ? 'blob:smile' : undefined))).toBe('<img src="blob:smile"><div style="background: url()">');
  });
});

describe('storyHtml', () => {
  it('shows each line as its own paragraph, with actions, bold and dialogue marked, and Korean marks read', () => {
    expect(storyHtml('*고개를 끄덕였다.*그리고 **굵게**\n"좋아."그리고 “네” 했다.', true)).toBe(
      '<p><em>고개를 끄덕였다.</em>그리고 <strong>굵게</strong></p>\n<p><mark risu-mark="quote2">&quot;좋아.&quot;</mark>그리고 <mark risu-mark="quote2">“네”</mark> 했다.</p>\n',
    );
  });

  it('runs a mark left open to the end of its line, and closes and reopens one a closing mark cuts through', () => {
    expect(storyHtml('*그녀가 "안녕\n다음 줄', true)).toBe('<p><em>그녀가 <mark risu-mark="quote2">&quot;안녕</mark></em></p>\n<p>다음 줄</p>\n');
    expect(storyHtml('*a "b* c"', true)).toBe('<p><em>a <mark risu-mark="quote2">&quot;b</mark></em><mark risu-mark="quote2"> c&quot;</mark></p>\n');
  });

  it('keeps a bot’s HTML block as written and escapes it without bot', () => {
    expect(storyHtml('<div class="box">\n*raw*\n</div>\n\n*act*', true)).toBe('<div class="box">\n*raw*\n</div>\n<p><em>act</em></p>\n');
    expect(storyHtml('<b>x</b> \\*y\\*', false)).toBe('<p>&lt;b&gt;x&lt;/b&gt; *y*</p>\n');
  });
});
