import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { CardGrid } from './CardGrid';
import { List, ListItem } from './List';
import { Viewport } from './Viewport';

it('does not construct unmeasured offscreen cards or rows, but includes a requested current row', () => {
  const keys = Array.from({ length: 10_000 }, (_, i) => `row-${i}`);
  const card = vi.fn((index: number) => <button>{keys[index]}</button>);
  renderToStaticMarkup(<CardGrid label="cards" keys={keys}>{card}</CardGrid>);
  expect(card).toHaveBeenCalledTimes(1);
  const row = vi.fn((index: number) => <button>{keys[index]}</button>);
  const html = renderToStaticMarkup(<Viewport keys={keys} current="row-9999">{row}</Viewport>);
  expect(row.mock.calls.map(([index]) => index)).toEqual([0, 9999]);
  expect(html).toContain('row-9999');
});

it('makes a windowed list one ul whose rows are its li', () => {
  const html = renderToStaticMarkup(<List label="휴지통" keys={['a', 'b']}>{(index) => <ListItem title={`row ${index}`} />}</List>);
  expect(html).toMatch(/^<ul [^>]*aria-label="휴지통"[^>]*><li /);
  expect(html.match(/<li /g)).toHaveLength(1);
});
