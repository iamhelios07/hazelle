export const noResults = (words: string) => `“${words}” 검색 결과가 없어요.`;

// A list shows its search from this many items; fewer are read at a glance.
export const SEARCH_FROM = 8;

export const matches = (words: string, ...texts: string[]) => texts.join(' ').toLowerCase().includes(words.trim().toLowerCase());
