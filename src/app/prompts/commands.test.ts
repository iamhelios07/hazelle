import { describe, expect, it } from 'vitest';
import { unescapeCbs } from '../../engine/cbs/escape';
import { evaluate, type CbsContext } from '../../engine/cbs/evaluate';
import { normalize, tagNames } from '../../engine/cbs/tags';
import { commandSnippet, COMMANDS } from './commands';

const commands = COMMANDS.flatMap((group) => group.commands);

const context: CbsContext = {
  stage: 'prompt',
  card: null,
  persona: null,
  prompt: null,
  lore: [],
  messages: [],
  source: { seed: 'request-1' },
  greeting: null,
  variables: new Map(),
  toggle: () => null,
  model: null,
  screen: null,
  clock: { now: Date.UTC(2026, 9, 1), timeZone: 'UTC' },
  language: 'Korean',
  assets: [],
  faces: { char: null, user: null },
  pickSeed: 'pick-1',
};

describe('COMMANDS', () => {
  it('describes every tag the engine evaluates, once, under the name its form writes', () => {
    const names = commands.flatMap((command) => command.names);
    expect(names.toSorted()).toEqual(tagNames().toSorted());
    for (const { names, form } of commands.filter((command) => command.names.length)) expect(normalize(/^\{\{([^:}]+|:)/.exec(form)![1]!)).toBe(names[0]);
  });

  it('gives the result each example shows', () => {
    for (const { example } of commands.filter((command) => command.example)) expect(unescapeCbs(evaluate(example![0], context))).toBe(example![1]);
  });
});

describe('commandSnippet', () => {
  it('selects the first place to write, or puts the caret after a tag that takes none', () => {
    const get = commandSnippet({ names: ['getvar'], form: '{{getvar::이름}}', what: '' });
    expect(get.text.slice(...get.select)).toBe('이름');
    expect(commandSnippet({ names: ['char'], form: '{{char}}', what: '' }).select).toEqual([8, 8]);
  });
});
