import { expect, it, vi } from 'vitest';
import { MEDIA, mediaQuery } from './media';

// Every stylesheet in the app, as text (vitest.config.ts lets ?raw stylesheets through).
const sheets = import.meta.glob<string>('/src/app/**/*.css', { query: '?raw', import: 'default', eager: true });

it('writes every media query from MEDIA', () => {
  const found = Object.entries(sheets).flatMap(([path, css]) => [...css.matchAll(/@media\s+([^{]*?)\s*\{/g)].map((match) => ({ path, query: match[1] })));
  const listed: string[] = Object.values(MEDIA);
  expect(found.length).toBeGreaterThan(0);
  expect(found.filter(({ query }) => !listed.includes(query!))).toEqual([]);
});

it('shares one live query per condition, fans out changes, and detaches after the last subscriber', () => {
  const native = new Set<() => void>();
  const list = { matches: true, addEventListener: vi.fn((_: string, listener: () => void) => native.add(listener)), removeEventListener: vi.fn((_: string, listener: () => void) => native.delete(listener)) };
  const match = vi.fn(() => list);
  vi.stubGlobal('matchMedia', match);
  try {
    const hover = mediaQuery(MEDIA.hover);
    expect(mediaQuery(MEDIA.hover)).toBe(hover);
    expect(match).not.toHaveBeenCalled();
    expect(hover.read()).toBe(true);
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = hover.subscribe(first);
    const stopSecond = hover.subscribe(second);
    expect(hover.read()).toBe(true);
    expect(match).toHaveBeenCalledExactlyOnceWith(MEDIA.hover);
    expect(list.addEventListener).toHaveBeenCalledOnce();
    list.matches = false;
    for (const listener of native) listener();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(hover.read()).toBe(false);
    stopFirst();
    expect(list.removeEventListener).not.toHaveBeenCalled();
    stopSecond();
    expect(list.removeEventListener).toHaveBeenCalledOnce();
    expect(native.size).toBe(0);
    list.matches = true;
    expect(hover.read()).toBe(true);
    const stopAgain = hover.subscribe(first);
    expect(list.addEventListener).toHaveBeenCalledTimes(2);
    expect(match).toHaveBeenCalledOnce();
    stopAgain();
    expect(native.size).toBe(0);
    expect(mediaQuery(MEDIA.wide)).not.toBe(hover);
  } finally {
    vi.unstubAllGlobals();
  }
});
