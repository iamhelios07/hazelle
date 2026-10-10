// name is what is stored and what the translation prompt's {{language}} receives; label is how the app shows it.
export const LANGUAGES = [
  { name: 'Korean', label: '한국어' },
  { name: 'English', label: '영어' },
  { name: 'Japanese', label: '일본어' },
  { name: 'Chinese (Simplified)', label: '중국어 간체' },
  { name: 'Chinese (Traditional)', label: '중국어 번체' },
  { name: 'Spanish', label: '스페인어' },
  { name: 'French', label: '프랑스어' },
  { name: 'German', label: '독일어' },
  { name: 'Russian', label: '러시아어' },
  { name: 'Portuguese', label: '포르투갈어' },
  { name: 'Italian', label: '이탈리아어' },
  { name: 'Vietnamese', label: '베트남어' },
  { name: 'Thai', label: '태국어' },
  { name: 'Indonesian', label: '인도네시아어' },
] as const;

export function languageLabel(name: string): string {
  return LANGUAGES.find((language) => language.name === name)?.label ?? name;
}

// The final consonant of the word's last syllable, 0 for none (8 is ㄹ); null when it does not end in Hangul.
export function finalOf(word: string): number | null {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code < 11172 ? code % 28 : null;
}

// The word with 로 or 으로: 으로 after a final consonant other than ㄹ. After a word that does not end in Hangul, such
// as a typed language name, the sound is not known, so it reads (으)로.
export function withRo(word: string): string {
  const final = finalOf(word);
  if (final === null) return `${word}(으)로`;
  return final === 0 || final === 8 ? `${word}로` : `${word}으로`;
}
