import { describe, expect, it } from 'vitest';
import { paragraphs } from './prose';

describe('paragraphs', () => {
  it('splits lines and marks dialogue and actions', () => {
    expect(paragraphs('세라가 웃는다. “안녕.” *손을 흔든다*\n\n"끝"')).toEqual([
      [
        { kind: 'narration', text: '세라가 웃는다. ' },
        { kind: 'dialogue', text: '“안녕.”' },
        { kind: 'narration', text: ' ' },
        { kind: 'action', text: '손을 흔든다' },
      ],
      [{ kind: 'dialogue', text: '"끝"' }],
    ]);
  });

  it('runs an unclosed mark to the end of the line while streaming', () => {
    expect(paragraphs('“아직 말하는')).toEqual([[{ kind: 'dialogue', text: '“아직 말하는' }]]);
  });
});
