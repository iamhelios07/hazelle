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

function watch(query: string) {
  const subscribe = (listener: () => void) => {
    const list = matchMedia(query);
    list.addEventListener('change', listener);
    return () => list.removeEventListener('change', listener);
  };
  const read = () => matchMedia(query).matches;
  return () => useSyncExternalStore(subscribe, read);
}

// Which layout the app shell takes: the sidebar beside the page, or one screen at a time (phones).
export const useWide = watch(MEDIA.wide);

// Whether list screens show the picked item beside the list (ListDetail).
export const useSplit = watch(MEDIA.split);

// Whether things show on hover; without it they show on a tap.
export const useHover = watch(MEDIA.hover);
