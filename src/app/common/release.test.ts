import { expect, it } from 'vitest';
import { openedNewRelease, tourToShow, type Tour } from './release';

it('shows the newest tour once no tutorial is left, on a device that has not seen it, never without a built version', () => {
  const tour = (version: string): Tour => ({ version, title: 't', pages: [{ title: 'p', text: 'x', art: 'board-list' }], go: { label: 'g', route: { kind: 'board', operator: false } } });
  const tours = [tour('v1.0.1'), tour('v1.0.0')];
  expect(tourToShow('v1.0.2', '', tours, true)).toBe(tours[0]);
  expect(tourToShow('v1.0.2', '', tours, false)).toBeNull();
  expect(tourToShow('v1.0.2', 'v1.0.1', tours, true)).toBeNull();
  expect(tourToShow(null, '', tours, true)).toBeNull();
  expect(tourToShow('v1.0.2', '', [], true)).toBeNull();
});

it('tells of a release once, on a device that opened another release before', () => {
  expect(openedNewRelease('v1.0.1', 'v1.0.0')).toBe(true);
  expect(openedNewRelease('v1.0.1', 'v1.0.1')).toBe(false);
  expect(openedNewRelease('v1.0.1', '')).toBe(false);
  expect(openedNewRelease(null, 'v1.0.0')).toBe(false);
});
