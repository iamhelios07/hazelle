import { expect, it } from 'vitest';
import { splitLinks } from './linkify';

it('links web addresses inside text, leaving a sentence end and an unopened ) outside the link', () => {
  expect(splitLinks('여기 https://a.example/x?y=1. 그리고 (http://b.example/p) 끝')).toEqual([
    { text: '여기 ' },
    { text: 'https://a.example/x?y=1', href: 'https://a.example/x?y=1' },
    { text: '. 그리고 (' },
    { text: 'http://b.example/p', href: 'http://b.example/p' },
    { text: ') 끝' },
  ]);
  expect(splitLinks('https://w.example/a_(b)')).toEqual([{ text: 'https://w.example/a_(b)', href: 'https://w.example/a_(b)' }]);
  expect(splitLinks('javascript:alert(1)\n줄')).toEqual([{ text: 'javascript:alert(1)\n줄' }]);
});
