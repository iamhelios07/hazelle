import { describe, expect, it } from 'vitest';
import { normalize, tagNames } from '../../engine/cbs/tags';
import { commandSnippet, COMMANDS } from './commands';
import { tryExample } from './guides';

const commands = COMMANDS.flatMap((group) => group.commands);


describe('COMMANDS', () => {
  it('describes every tag the engine evaluates, once, under the name its form writes', () => {
    const names = commands.flatMap((command) => command.names);
    expect(names.toSorted()).toEqual(tagNames().toSorted());
    for (const { names, form } of commands.filter((command) => command.names.length)) expect(normalize(/^\{\{([^:}]+|:)/.exec(form)![1]!)).toBe(names[0]);
  });

  it('gives the result each example shows', () => {
    for (const { example } of commands.filter((command) => command.example)) expect(tryExample(example![0])).toBe(example![1]);
  });
});

describe('commandSnippet', () => {
  it('selects the first place to write, or puts the caret after a tag that takes none', () => {
    const get = commandSnippet({ names: ['getvar'], form: '{{getvar::이름}}', what: '' });
    expect(get.text.slice(...get.select)).toBe('이름');
    expect(commandSnippet({ names: ['char'], form: '{{char}}', what: '' }).select).toEqual([8, 8]);
  });
});
