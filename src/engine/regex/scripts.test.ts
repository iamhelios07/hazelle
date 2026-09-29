import { describe, expect, it } from 'vitest';
import type { HistoryMessage } from '../history';
import type { RegexScript } from '../import/types';
import { applyScripts, type Context } from './scripts';

const script = (find: string, replace: string, over: Partial<RegexScript> = {}): RegexScript => ({ name: find, find, replace, stage: 'display', flags: null, ...over });
const message = (role: HistoryMessage['role'], text: string, index: number): HistoryMessage => ({ id: `m${index}`, seed: `m${index}`, role, text, time: null });
const cbs = (text: string) => text.replaceAll('{{user}}', 'jin');
const apply = (scripts: RegexScript[], text: string, over: Partial<Context> = {}) =>
  applyScripts('display', text, { scripts, messages: [message('assistant', text, 0)], index: 0, cbs, ...over });

describe('applyScripts', () => {
  it('runs only its stage, globally by default; a custom flag string replaces g and keeps only valid flag letters', () => {
    expect(apply([script('a', 'b'), script('a', 'X', { stage: 'output' })], 'aAa').text).toBe('bAb');
    expect(apply([script('a', 'b', { flags: 'iz' })], 'AaA').text).toBe('baA');
    expect(apply([script('a', 'b', { flags: '<no_end_nl>' })], 'aa').text).toBe('bb');
    // No valid letter means no flags, not Risu's `u`, under which `\-` does not compile.
    expect(apply([script('\\-', '+', { flags: 'z' })], 'a-b-')).toEqual({ text: 'a+b-', skipped: [] });
  });

  it('stable-sorts by <order N>, highest first, with scripts that have none at 0', () => {
    const scripts = [script('a', 'b'), script('a', 'c', { flags: '<order 5>' }), script('c', 'd', { flags: '<order 5>' }), script('b', 'e', { flags: '<order -1>' })];
    expect(apply(scripts, 'a').text).toBe('d');
  });

  it('expands $<name>, $2, $& and $$, fills {{data}} with the whole match (design §5 row 10), and turns $n into a newline', () => {
    expect(apply([script('(?<key>\\w+)=(\\d)', '[$<key>:$2:$&:$$:{{data}}]$nok')], 'hp=3').text).toBe('[hp:3:hp=3:$:hp=3]\nok');
  });

  it('ends a replacement that ends in a tag with a newline, unless <no_end_nl>', () => {
    expect(apply([script('x', '<br>')], 'x').text).toBe('<br>\n');
    expect(apply([script('x', '<br>', { flags: '<no_end_nl>' })], 'x').text).toBe('<br>');
  });

  it('fills CBS in the text before the scripts and after each replacement, and in the pattern only with <cbs>', () => {
    expect(apply([script('jin', 'hi {{user}}')], '{{user}}').text).toBe('hi jin');
    expect(apply([script('{{user}}', 'X')], '{{user}}').text).toBe('jin');
    expect(apply([script('{{user}}', 'X', { flags: '<cbs>' })], '{{user}}').text).toBe('X');
  });

  it('skips a script whose pattern is empty, also after CBS', () => {
    const blank = (text: string) => text.replaceAll('{{unset}}', '');
    expect(apply([script('', 'X'), script('{{unset}}', 'X', { flags: '<cbs>' })], 'ab', { cbs: blank })).toEqual({ text: 'ab', skipped: [] });
  });

  it('keeps no result cache, so a random tag in a replacement rolls on each call (design §5 row 11)', () => {
    let rolls = 0;
    const roll = (text: string) => text.replaceAll('{{roll}}', () => String(++rolls));
    const scripts = [script('a', '{{roll}}')];
    expect([apply(scripts, 'a', { cbs: roll }).text, apply(scripts, 'a', { cbs: roll }).text]).toEqual(['1', '2']);
  });

  it('moves only the first match to the top or the bottom, with $1 expanded', () => {
    const text = 'a<s>1</s>b<s>2</s>';
    expect(apply([script('<s>(\\d)</s>', '@@move_top [$1]')], text).text).toBe('[1]ab<s>2</s>');
    expect(apply([script('<s>(\\d)</s>', '<t>$1</t>', { flags: '<move_bottom>' })], text).text).toBe('ab<s>2</s><t>1</t>\n');
  });

  it('repeats the latest earlier same-role match onto a message without one, and leaves a message with one alone', () => {
    const messages = [
      message('assistant', 'hi <hp>9</hp>', 0),
      message('user', 'a <hp>1</hp>', 1),
      message('assistant', 'no status', 2),
      message('user', 'b', 3),
      message('assistant', 'still none', 4),
    ];
    const at = (out: string, text: string, flags: string | null = null) =>
      applyScripts('display', text, { scripts: [script('<hp>\\d+</hp>', out, { flags })], messages, index: 4, cbs }).text;
    expect(at('@@repeat_back end_nl', 'still none')).toBe('still none\n<hp>9</hp>');
    expect(at('@@repeat_back start', 'still none')).toBe('<hp>9</hp>still none');
    expect(at('', 'still none', '<repeat_back>')).toBe('still none<hp>9</hp>');
    expect(at('@@repeat_back end', 'now <hp>4</hp>')).toBe('now <hp>4</hp>');
  });

  it('removes the matches on inject, whatever the replacement says (design §5 row 19)', () => {
    expect(apply([script('\\[\\w\\]', '@@inject')], 'a [x] b [y]').text).toBe('a  b ');
    expect(apply([script('\\[\\w\\]', 'kept?', { flags: '<inject>' })], 'a [x] b [y]').text).toBe('a  b ');
  });

  it('skips a script with an invalid pattern and says why, and runs the rest', () => {
    const scripts = [script('(', 'x'), script('a', 'b')];
    expect(apply(scripts, 'a(')).toEqual({ text: 'b(', skipped: [{ script: scripts[0], reason: { kind: 'invalid', detail: expect.stringContaining('Invalid regular expression') } }] });
  });

  it('skips an emotion script, since emotion images are not supported, and leaves the text', () => {
    const scripts = [script('a', '@@emo happy')];
    expect(apply(scripts, 'a')).toEqual({ text: 'a', skipped: [{ script: scripts[0], reason: { kind: 'emotion' } }] });
  });
});
