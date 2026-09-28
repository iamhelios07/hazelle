import { expect, it } from 'vitest';
import { MEDIA } from './media';

// Every stylesheet in the app, as text (vitest.config.ts lets ?raw stylesheets through).
const sheets = import.meta.glob<string>('/src/app/**/*.css', { query: '?raw', import: 'default', eager: true });

it('writes every media query from MEDIA', () => {
  const found = Object.entries(sheets).flatMap(([path, css]) => [...css.matchAll(/@media\s+([^{]*?)\s*\{/g)].map((match) => ({ path, query: match[1] })));
  const listed: string[] = Object.values(MEDIA);
  expect(found.length).toBeGreaterThan(0);
  expect(found.filter(({ query }) => !listed.includes(query!))).toEqual([]);
});
