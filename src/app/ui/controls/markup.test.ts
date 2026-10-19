import { describe, expect, it } from 'vitest';
import type { CodeSpan } from './codeLanguage';
import { markup } from './markup';

const spansOf = (text: string, ...tags: [string, CodeSpan['kind']][]) => tags.map(([tag, kind]) => ({ from: text.indexOf(tag), to: text.indexOf(tag) + tag.length, kind }));

describe('markup', () => {
  it('marks the spans, headings, rules and <angle> tags outside the spans, and joins back to the text', () => {
    const text = '<System Setting>\n# The Work\nYou are {{char}}.\n---\n<Role-play Materials>{{slot}}\n{{x::<b>}}';
    const pieces = markup(text, spansOf(text, ['{{char}}', 'tag'], ['{{slot}}', 'slot'], ['{{x::<b>}}', 'argument']));
    expect(pieces.map((piece) => piece.text).join('')).toBe(text);
    expect(pieces.filter((piece) => piece.mark === 'angle').map((piece) => piece.text)).toEqual(['<System Setting>', '<Role-play Materials>']);
    expect(pieces.filter((piece) => piece.mark === 'tag').map((piece) => piece.text)).toEqual(['{{char}}']);
    expect(pieces.find((piece) => piece.mark === 'slot')?.text).toBe('{{slot}}');
    expect(pieces.find((piece) => piece.text.startsWith('# The'))?.line).toBe('heading');
    expect(pieces.find((piece) => piece.text === '---\n')?.line).toBe('rule');
  });

  it('cuts a span that crosses a line at the line, so each line keeps its own look', () => {
    const text = '# {{// a\nb}}';
    expect(markup(text, [{ from: 2, to: text.length, kind: 'comment' }])).toEqual([
      { text: '# ', line: 'heading', mark: null },
      { text: '{{// a\n', line: 'heading', mark: 'comment' },
      { text: 'b}}', line: 'body', mark: 'comment' },
    ]);
  });
});
