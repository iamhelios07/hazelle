import { describe, expect, it } from 'vitest';
import { conditionSnippet } from './edits';

describe('conditionSnippet', () => {
  it('puts the selected text in the first branch and selects the next branch to write', () => {
    const check = conditionSnippet({ key: 'sims', label: '시뮬레이터 모드', kind: 'check', default: '0' }, 'hello');
    expect(check.text).toBe('{{#when::toggle::sims}}hello{{:else}}껐을 때 내용{{/when}}');
    expect(check.text.slice(...check.select)).toBe('껐을 때 내용');

    const choice = conditionSnippet({ key: 'tone', label: '말투', kind: 'choice', options: ['간결', '풍부'], default: '0' }, 'hello');
    expect(choice.text).toBe('{{#when::tone::tis::0}}hello{{/when}}{{#when::tone::tis::1}}풍부일 때 내용{{/when}}');
    expect(choice.text.slice(...choice.select)).toBe('풍부일 때 내용');
  });
});
