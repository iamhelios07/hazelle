export type Segment = { kind: 'narration' | 'dialogue' | 'action'; text: string };

// “Dialogue” and "dialogue" keep their quotes; *actions* lose their asterisks. An unclosed mark runs
// to the end of the line, which is how a reply looks while it streams.
const MARKS = /(“[^”]*”?|"[^"]*"?|\*[^*]*\*?)/g;

// A reply's text as paragraphs of segments, one paragraph per non-empty line.
export function paragraphs(text: string): Segment[][] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const segments: Segment[] = [];
      let last = 0;
      for (const match of line.matchAll(MARKS)) {
        if (match.index > last) segments.push({ kind: 'narration', text: line.slice(last, match.index) });
        const mark = match[0];
        segments.push(mark.startsWith('*') ? { kind: 'action', text: mark.replaceAll('*', '') } : { kind: 'dialogue', text: mark });
        last = match.index + mark.length;
      }
      if (last < line.length) segments.push({ kind: 'narration', text: line.slice(last) });
      return segments;
    });
}
