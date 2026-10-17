import { useState, type Ref } from 'react';
import { SearchField } from '../ui';
import { matches, noResults, SEARCH_FROM } from './search';

// A picker's search: Enter in its field picks the first found once words are typed (with none, the first item may sit
// in a folder not shown), and ref lets the picker focus the field as it opens.
// query: words held by a parent that outlives the list, such as the sidebar's across entering a shelf.
export type SearchOptions<T> = { ref?: Ref<HTMLInputElement>; onEnter?: (first: T) => void; query?: readonly [string, (query: string) => void] };

// One list's search: the field shows from SEARCH_FROM items and stays while words are typed, so a list shrinking
// under a search keeps the field that filters it.
export function useSearch<T>(items: readonly T[], label: string, texts: (item: T) => string[], options: SearchOptions<T> = {}) {
  const own = useState('');
  const [query, setQuery] = options.query ?? own;
  const { ref, onEnter } = options;
  const words = query.trim();
  const found = words ? items.filter((item) => matches(words, ...texts(item))) : items;
  const first = found[0];
  return {
    words,
    found,
    field: (items.length >= SEARCH_FROM || words !== '') && (
      <SearchField
        size="sm"
        label={label}
        value={query}
        onChange={setQuery}
        ref={ref}
        onKeyDown={
          onEnter &&
          ((event) => {
            if (event.key !== 'Enter' || !words || first === undefined) return;
            event.preventDefault();
            onEnter(first);
          })
        }
      />
    ),
    none: words !== '' && found.length === 0 ? noResults(words) : null,
  };
}
