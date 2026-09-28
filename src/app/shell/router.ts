import { useMemo, useSyncExternalStore } from 'react';
import { href, parseRoute, type Route } from './routes';

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

const address = () => location.pathname + location.search;

export function useRoute(): Route {
  const at = useSyncExternalStore(subscribe, address);
  return useMemo(() => parseRoute(at), [at]);
}

export function navigate(route: Route, { replace = false } = {}) {
  const at = href(route);
  if (at === address()) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', at);
  window.scrollTo(0, 0);
  window.dispatchEvent(new Event(NAVIGATED));
}
