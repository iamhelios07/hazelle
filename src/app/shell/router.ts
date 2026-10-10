import { useMemo, useSyncExternalStore } from 'react';
import { href, parseRoute, type Back, type Route } from './routes';

// A router library would add nothing for a handful of fixed paths.
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

// NavBar's back; none where back is null, since a sidebar beside the screen is the way back.
export const backBar = (back: Back | null) => (back ? { onBack: () => navigate(back.to), backLabel: back.label } : {});
