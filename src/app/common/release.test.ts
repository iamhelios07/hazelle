import { expect, it } from 'vitest';
import { newsToSay, type News } from './release';

it('says the news of a release once, on a device that opened another release before', () => {
  const news: News[] = [{ version: 'v1.0.1', date: '2026-11-01', lines: ['a'] }];
  expect(newsToSay('v1.0.1', 'v1.0.0', news)).toBe(news[0]);
  expect(newsToSay('v1.0.1', 'v1.0.1', news)).toBeNull();
  expect(newsToSay('v1.0.1', '', news)).toBeNull();
  expect(newsToSay('v1.0.2', 'v1.0.1', news)).toBeNull();
  expect(newsToSay(null, 'v1.0.0', news)).toBeNull();
});
