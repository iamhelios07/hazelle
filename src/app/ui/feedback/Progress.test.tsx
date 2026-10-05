import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Progress } from './Progress';

it('draws a row per step, sums the counted ones into 전체 only when there are two, and lets an uncounted step flow', () => {
  const two = renderToStaticMarkup(<Progress steps={[{ label: '캐릭터', done: 120, total: 444 }, { label: '그림', done: 1500, total: 6467 }, { label: '읽는 중', done: 12345 }]} />);
  expect(two).toContain('전체');
  expect(two).toContain('1,620 / 6,911');
  expect(two).toContain('aria-valuenow="120"');
  expect(two).toContain('12,345');
  expect(two).toContain('slide');
  const one = renderToStaticMarkup(<Progress steps={[{ label: '내용', done: 3, total: 3 }]} />);
  expect(one).not.toContain('전체');
  expect(one).toContain('3 / 3');
  expect(renderToStaticMarkup(<Progress steps={[{ label: '그림 올리는 중' }]} />)).not.toMatch(/>[\d,]+</);
});
