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
