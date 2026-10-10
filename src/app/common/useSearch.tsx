import { useState } from 'react';
import { SearchField } from '../ui';
import { matches, noResults, SEARCH_FROM } from './search';

// One list's search: the field shows from SEARCH_FROM items and stays while words are typed, so a list shrinking
// under a search keeps the field that filters it.
export function useSearch<T>(items: readonly T[], label: string, texts: (item: T) => string[]) {
  const [query, setQuery] = useState('');
  const words = query.trim();
  const found = words ? items.filter((item) => matches(words, ...texts(item))) : items;
  return {
    words,
    found,
    field: (items.length >= SEARCH_FROM || words !== '') && <SearchField size="sm" label={label} value={query} onChange={setQuery} />,
    none: words !== '' && found.length === 0 ? noResults(words) : null,
  };
}
