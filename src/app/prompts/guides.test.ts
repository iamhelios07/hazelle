import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../common/code/cbsCommands';
import { GUIDES, tryExample } from './guides';

describe('GUIDES', () => {
  it('gives the result each example shows', () => {
    for (const { example } of Object.values(GUIDES).flatMap((guide) => guide.steps)) if (example) expect(tryExample(example.written, example.inMessage)).toBe(example.result);
  });
});

describe('COMMANDS', () => {
  it('gives the result each example shows', () => {
    for (const { example } of COMMANDS.flatMap((group) => group.commands)) if (example) expect(tryExample(example[0])).toBe(example[1]);
  });
});
