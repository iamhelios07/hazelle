import { useSyncExternalStore } from 'react';

// Every media query in the app. Stylesheets cannot read these, so each writes its query out in full,
// and media.test.ts fails on an @media that is not one of them.
export const MEDIA = {
  // Room for the sidebar beside the page. narrow is its complement: change the two together.
  wide: '(min-width: 960px)',
  narrow: '(max-width: 959px)',
  // Room, beside the sidebar, for a list and the item picked from it.
  split: '(min-width: 1200px)',
  // Too narrow for the story and a side panel side by side, so the panel covers the page.
  panelCovers: '(max-width: 1279px)',
  // Wider than a phone: a screen's column sits lower on the page instead of filling it.
  roomy: '(min-width: 600px)',
  // A pointer that hovers. A touch screen keeps :hover on whatever was tapped last.
  hover: '(hover: hover)',
  reducedMotion: '(prefers-reduced-motion: reduce)',
} as const;

type Query = { subscribe: (listener: () => void) => () => void; read: () => boolean };
const queries = new Map<string, Query>();

export function mediaQuery(query: string): Query {
  const found = queries.get(query);
  if (found) return found;
  let list: MediaQueryList | undefined;
  const readList = () => (list ??= matchMedia(query));
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of [...listeners]) listener();
  };
  const subscribe = (listener: () => void) => {
    if (listeners.size === 0) readList().addEventListener('change', changed);
    listeners.add(listener);
    return () => {
      if (listeners.delete(listener) && listeners.size === 0) readList().removeEventListener('change', changed);
    };
  };
  const state = { subscribe, read: () => readList().matches };
  queries.set(query, state);
  return state;
}

function watch(query: string) {
  const { subscribe, read } = mediaQuery(query);
  return () => useSyncExternalStore(subscribe, read);
}

// Which layout the app shell takes: the sidebar beside the page, or one screen at a time (phones).
export const useWide = watch(MEDIA.wide);

// Whether list screens show the picked item beside the list (ListDetail).
export const useSplit = watch(MEDIA.split);

// Whether a side panel lies over the page instead of beside it.
export const usePanelCovers = watch(MEDIA.panelCovers);

// Whether things show on hover; without it they show on a tap.
export const useHover = watch(MEDIA.hover);

// The window's size as `width x height`, for bots that lay out by it ({{screen_width}}). A string, so an unchanged size
// is the same snapshot.
const subscribeResize = (listener: () => void) => {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
};
export const useViewport = () => useSyncExternalStore(subscribeResize, () => `${innerWidth}x${innerHeight}`);
