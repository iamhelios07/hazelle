import { createContext, useContext, useSyncExternalStore } from 'react';

// The same widths are written in this folder's media queries, which cannot read custom properties.
// WIDE: room for the sidebar beside the page. SPLIT: room, beside the sidebar, for a list and the item
// picked from it.
const WIDE = '(min-width: 960px)';
const SPLIT = '(min-width: 1200px)';

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const list = matchMedia(query);
      list.addEventListener('change', listener);
      return () => list.removeEventListener('change', listener);
    },
    () => matchMedia(query).matches,
  );
}

// Which layout the app shell takes: the sidebar beside the page, or one screen at a time (phones).
export const useWide = () => useMedia(WIDE);

// Whether list screens show the picked item beside the list (ListDetail).
export const useSplit = () => useMedia(SPLIT);

export const PaneContext = createContext<'list' | 'detail' | null>(null);

// Which pane of a ListDetail a screen is in, or null on a page of its own.
export const usePane = () => useContext(PaneContext);
