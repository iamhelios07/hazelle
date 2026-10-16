// One stretch of a tag field and the weight NovelAI reads it with; null for the syntax itself. The pieces joined give
// back the text exactly, as markup's do.
type WeightPiece = { text: string; weight: number | null };

// As docs.novelai.net/en/image/strengthening-weakening states it: each { multiplies by 1.05 and each [ divides, nested
// ones compound; `1.5::` sets a weight (V4+, below 0 on V4.5+) until a bare `::`, which also closes every open bracket.
const NUMBER = /^-?(?:\d+(?:\.\d*)?|\.\d+)::/;
const STEP = 1.05;

export function tagWeights(text: string): WeightPiece[] {
  const pieces: WeightPiece[] = [];
  const push = (piece: string, weight: number | null) => {
    const last = pieces.at(-1);
    if (last && last.weight === weight) last.text += piece;
    else pieces.push({ text: piece, weight });
  };
  let depth = 0;
  let numeric = 1;
  let at = 0;
  while (at < text.length) {
    const char = text[at]!;
    const number = /[-.\d]/.test(char) && !/[-.\d]/.test(text[at - 1] ?? '') ? NUMBER.exec(text.slice(at)) : null;
    if (number) {
      numeric = Number(number[0].slice(0, -2));
      push(number[0], null);
      at += number[0].length;
    } else if (text.startsWith('::', at)) {
      numeric = 1;
      depth = 0;
      push('::', null);
      at += 2;
    } else if ('{}[]'.includes(char)) {
      depth += char === '{' || char === ']' ? 1 : -1;
      push(char, null);
      at += 1;
    } else {
      push(char, numeric * STEP ** depth);
      at += 1;
    }
  }
  return pieces;
}
