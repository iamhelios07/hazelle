import { useState, type Ref } from 'react';
import { SearchField } from '../ui';
import { matches, noResults, SEARCH_FROM } from './search';

// A picker's search: Enter in its field picks the first found, and ref lets the picker focus the field as it opens.
type Picker<T> = { ref: Ref<HTMLInputElement>; onEnter: (first: T) => void };

// One list's search: the field shows from SEARCH_FROM items and stays while words are typed, so a list shrinking
// under a search keeps the field that filters it.
export function useSearch<T>(items: readonly T[], label: string, texts: (item: T) => string[], picker?: Picker<T>) {
  const [query, setQuery] = useState('');
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
        ref={picker?.ref}
        onKeyDown={
          picker &&
          ((event) => {
            if (event.key !== 'Enter' || first === undefined) return;
            event.preventDefault();
            picker.onEnter(first);
          })
        }
      />
    ),
    none: words !== '' && found.length === 0 ? noResults(words) : null,
  };
}
