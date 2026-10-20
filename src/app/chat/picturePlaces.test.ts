import { expect, it } from 'vitest';
import type { Stored } from '../../model/kinds';
import { pagedPicture } from './picturePlaces';

it('shows the picture paged to until a newer one lands in its place', () => {
  const [old, newer, newest] = ['a', 'b', 'c'].map((id) => ({ id }) as Stored<'illustration'>);
  expect(pagedPicture([old!, newer!], null)).toBe(newer);
  expect(pagedPicture([old!, newer!], { id: 'a', newest: 'b' })).toBe(old);
  expect(pagedPicture([old!, newer!, newest!], { id: 'a', newest: 'b' })).toBe(newest);
  expect(pagedPicture([newer!], { id: 'a', newest: 'b' })).toBe(newer);
});
