import { describe, expect, it } from 'vitest';
import { normalize, tagNames } from '../../../engine/cbs/tags';
import { COMMANDS } from './cbsCommands';

describe('COMMANDS', () => {
  it('describes every tag the engine evaluates, once, under the name its form writes', () => {
    const commands = COMMANDS.flatMap((group) => group.commands);
    expect(commands.flatMap((command) => command.names).toSorted()).toEqual(tagNames().toSorted());
    for (const { names, form } of commands.filter((command) => command.names.length)) expect(normalize(/^\{\{([^:}]+|:)/.exec(form)![1]!)).toBe(names[0]);
  });
});
