// What a message reads as: its translation unless flipped to the original, or the translation streaming in.
export const seenText = (original: string, translation: string | null, translating: string | null, flipped: boolean) =>
  flipped ? original : translating || (translation ?? original);

// Only what is shaped like a tag, so prose such as "a < b > c" keeps its words.
const TAG = /<\/?[a-z][^>]*>/gi;

export const foldTerm = (term: string) => term.trim().normalize('NFC').toLowerCase();

const fold = (text: string) => text.replace(TAG, '').normalize('NFC').toLowerCase();

// Hits are message indices in chat order. It keeps each text's fold and answer from the call before, so a story of
// thousands of messages, searched again on every streamed frame, folds only the texts that changed.
export function finder() {
  let folds = new Map<string, string>();
  let asked = '';
  let answers = new Map<string, boolean>();
  return (texts: readonly string[], term: string): number[] => {
    const folded = foldTerm(term);
    if (!folded) return [];
    if (folded !== asked) answers = new Map();
    asked = folded;
    const nextFolds = new Map<string, string>();
    const nextAnswers = new Map<string, boolean>();
    const hits: number[] = [];
    texts.forEach((text, index) => {
      const plain = folds.get(text) ?? fold(text);
      const hit = answers.get(text) ?? plain.includes(folded);
      nextFolds.set(text, plain);
      nextAnswers.set(text, hit);
      if (hit) hits.push(index);
    });
    folds = nextFolds;
    answers = nextAnswers;
    return hits;
  };
}
