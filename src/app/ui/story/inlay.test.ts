import { expect, it } from 'vitest';
import { inlaid } from './inlay';

const MARK = '1';

it('puts the picture where its one mark stands, and at the end when the mark is gone or copied', () => {
  expect(inlaid(`<p>One</p>\n<p>${MARK}</p>\n<p>Two</p>\n`, MARK, '<img>')).toBe('<p>One</p>\n<p><img></p>\n<p>Two</p>\n');
  expect(inlaid(`<div>One ${MARK}</div>`, MARK, '<img>')).toBe('<div>One <img></div>');
  expect(inlaid('<p>One</p>', MARK, '<img>')).toBe('<p>One</p><p><img></p>');
  expect(inlaid(`<p>${MARK}</p><b>${MARK}</b>`, MARK, '<img>')).toBe('<b></b><p><img></p>');
});
