import { useSyncExternalStore } from 'react';

// Paths in the address bar, so the browser's back button and a reload keep the place. A router
// library would add nothing for a handful of fixed paths.
const NAVIGATED = 'risu-alpha:navigate';

function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener);
  window.addEventListener(NAVIGATED, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(NAVIGATED, listener);
  };
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => location.pathname);
}

export function navigate(path: string, { replace = false } = {}) {
  if (path === location.pathname) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', path);
  window.scrollTo(0, 0);
  window.dispatchEvent(new Event(NAVIGATED));
}
