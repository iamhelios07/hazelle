import { describe, expect, it } from 'vitest';
import { markup } from './markup';

describe('markup', () => {
  it('marks tags, headings and rules, and joins back to the text', () => {
    const text = '<System Setting>\n# The Work\nYou are {{char}}, {{#when::toggle::sims}}on{{/when}}.\n---\n<Role-play Materials>{{slot}}\n{{open';
    const pieces = markup(text);
    expect(pieces.map((piece) => piece.text).join('')).toBe(text);
    expect(pieces.filter((piece) => piece.mark === 'angle').map((piece) => piece.text)).toEqual(['<System Setting>', '<Role-play Materials>']);
    expect(pieces.filter((piece) => piece.mark === 'cbs').map((piece) => piece.text)).toEqual(['{{char}}', '{{#when::toggle::sims}}', '{{/when}}']);
    expect(pieces.find((piece) => piece.mark === 'slot')?.text).toBe('{{slot}}');
    expect(pieces.find((piece) => piece.text.startsWith('# The'))?.line).toBe('heading');
    expect(pieces.find((piece) => piece.text === '---\n')?.line).toBe('rule');
    expect(pieces.at(-1)).toEqual({ text: '{{open', line: 'body', mark: null });
  });

  it('reads a nested tag as one', () => {
    expect(markup('{{getvar::{{user}}}} x').map((piece) => piece.text)).toEqual(['{{getvar::{{user}}}}', ' x']);
  });

  it('reads a long line of unclosed tags in time, the closed one inside still a tag', () => {
    const open = '{'.repeat(100_000);
    expect(markup(`${open}}}`)).toEqual([
      { text: open.slice(3), line: 'body', mark: null },
      { text: '{{{}}', line: 'body', mark: 'cbs' },
    ]);
  });
});
