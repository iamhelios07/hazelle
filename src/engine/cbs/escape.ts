// Escaped punctuation stands in the private use area, U+E9B8 on, in this order. Escaped text holds no
// braces, so it survives every later CBS pass (the regex stage evaluates CBS again after each
// replacement), and unescapeCbs turns it back once, at the very end.
const PUNCTUATION = '{}()<>:;';
const FIRST = 0xe9b8;
const ESCAPED = /[-]/g;

export function escapeCbs(text: string, chars = PUNCTUATION): string {
  return [...text].map((char) => (chars.includes(char) ? String.fromCharCode(FIRST + PUNCTUATION.indexOf(char)) : char)).join('');
}

// Run on text just before it is sent or shown, after every CBS pass and regex stage.
export function unescapeCbs(text: string): string {
  return text.replace(ESCAPED, (char) => PUNCTUATION[char.charCodeAt(0) - FIRST]!);
}
