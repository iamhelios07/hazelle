import { useSyncExternalStore } from 'react';

// Wide enough for the sidebar beside the page. The same 960px is written in this folder's media
// queries, which cannot read custom properties.
const WIDE = '(min-width: 960px)';

function subscribe(listener: () => void) {
  const query = matchMedia(WIDE);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

// Which layout the app shell takes: the sidebar beside the page, or one screen at a time (phones).
export function useWide(): boolean {
  return useSyncExternalStore(subscribe, () => matchMedia(WIDE).matches);
}
