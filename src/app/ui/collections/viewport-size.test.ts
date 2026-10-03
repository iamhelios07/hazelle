import { expect, it } from 'vitest';
import { RowSizes } from './viewport-size';

it('locates measured variable-height rows and keeps offsets after edits, collapse and empty collections', () => {
  const rows = new RowSizes(10_000, 320);
  expect(rows.at(rows.offset(9_999))).toBe(9_999);
  rows.set(2, 1_600);
  rows.set(3, 40);
  expect(rows.offset(4)).toBe(2_280);
  expect(rows.at(2_279)).toBe(3);
  expect(rows.at(2_280)).toBe(4);
  const old = rows.offset(5_000);
  expect(rows.set(2, 80)).toBe(-1_520);
  expect(rows.offset(5_000)).toBe(old - 1_520);
  expect(rows.at(rows.offset(5_000) + 12)).toBe(5_000);
  expect(rows.at(-1)).toBe(0);
  expect(rows.at(Infinity)).toBe(9_999);
  expect(new RowSizes(0, 320).offset(0)).toBe(0);
});
