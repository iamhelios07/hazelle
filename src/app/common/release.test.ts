import { expect, it } from 'vitest';
import { newsToSay, tourToShow, type News } from './release';

it('shows the newest tour to anyone on a device that has not seen it, never without a built version', () => {
  const tour = { title: 't', pages: [{ title: 'p', text: 'x', art: 'board-list' as const }], go: { label: 'g', route: { kind: 'board' as const, operator: false } } };
  const news: News[] = [{ version: 'v1.0.2', date: '2026-11-02', lines: ['b'] }, { version: 'v1.0.1', date: '2026-11-01', lines: ['a'], tour }];
  expect(tourToShow('v1.0.2', '', news)).toBe(news[1]);
  expect(tourToShow('v1.0.2', 'v1.0.1', news)).toBeNull();
  expect(tourToShow(null, '', news)).toBeNull();
  expect(tourToShow('v1.0.2', '', news.slice(0, 1))).toBeNull();
});

it('says the news of a release once, on a device that opened another release before', () => {
  const news: News[] = [{ version: 'v1.0.1', date: '2026-11-01', lines: ['a'] }];
  expect(newsToSay('v1.0.1', 'v1.0.0', news)).toBe(news[0]);
  expect(newsToSay('v1.0.1', 'v1.0.1', news)).toBeNull();
  expect(newsToSay('v1.0.1', '', news)).toBeNull();
  expect(newsToSay('v1.0.2', 'v1.0.1', news)).toBeNull();
  expect(newsToSay(null, 'v1.0.0', news)).toBeNull();
});
