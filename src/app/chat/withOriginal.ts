import { isParagraph, paragraphsOf, withoutMarks } from '../../model/illustration';
import { ORIGINAL_MARK } from '../ui';

// 원문 함께 보기: each paragraph of the drawn translation followed by its original's, a blank line on either side so it
// stands as a block of its own; a picture's mark after its paragraph comes after the pair. Counts that differ put the
// whole original after the whole translation rather than pair paragraphs that do not match.
export function withOriginal(drawn: string, original: string): string {
  const originals = paragraphsOf(original).map((paragraph) => `\n${paragraph}${ORIGINAL_MARK}\n`);
  const lines = drawn.split('\n');
  const paragraph = (line: string) => isParagraph(withoutMarks(line));
  if (lines.filter(paragraph).length !== originals.length) return [drawn, ...originals].join('\n');
  let seen = 0;
  return lines.flatMap((line) => (paragraph(line) ? [line, originals[seen++]!] : [line])).join('\n');
}
