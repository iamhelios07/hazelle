import { describe, expect, it } from 'vitest';
import { commandSnippet, conditionSnippet } from './edits';

describe('conditionSnippet', () => {
  it('puts the selected text in the first branch and selects the next branch to write', () => {
    const check = conditionSnippet({ key: 'sims', label: '시뮬레이터 모드', kind: 'check', default: '0' }, 'hello');
    expect(check.text).toBe('{{#when::toggle::sims}}hello{{:else}}껐을 때 내용{{/when}}');
    expect(check.text.slice(...check.select)).toBe('껐을 때 내용');

    const choice = conditionSnippet({ key: 'tone', label: '말투', kind: 'choice', options: ['간결', '풍부'], default: '0' }, 'hello');
    expect(choice.text).toBe('{{#when::tone::tis::0}}hello{{/when}}{{#when::tone::tis::1}}풍부일 때 내용{{/when}}');
    expect(choice.text.slice(...choice.select)).toBe('풍부일 때 내용');
  });

  it('puts in a text toggle’s value after the selected text, since no condition holds for a typed value', () => {
    const text = conditionSnippet({ key: 'name', label: '이름', kind: 'text', default: '' }, '이름: ');
    expect(text).toEqual({ text: '이름: {{getglobalvar::toggle_name}}', select: [33, 33] });
  });
});

describe('commandSnippet', () => {
  it('selects the first place to write, or puts the caret after a tag that takes none', () => {
    const get = commandSnippet({ names: ['getvar'], form: '{{getvar::이름}}', what: '' });
    expect(get.text.slice(...get.select)).toBe('이름');
    expect(commandSnippet({ names: ['char'], form: '{{char}}', what: '' }).select).toEqual([8, 8]);
  });
});
