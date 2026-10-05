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

it('hero: fills the mark and says the floored percent of all counted work, checks a finished stage without its count, counts the one under way and leaves the rest hollow', () => {
  const html = renderToStaticMarkup(<Progress hero title="불러오는 중" note="처음 한 번만 전체를 받아요." steps={[{ label: '계정 확인', finished: true }, { label: '내용 받기', done: 1685, total: 168506 }, { label: '화면 준비' }]} />);
  expect(html).toContain('>0<span');
  expect(html).toContain('aria-valuenow="0"');
  expect(html).toContain('1,685 / 168,506');
  expect(html).toContain('처음 한 번만 전체를 받아요.');
  expect(html.indexOf('계정 확인')).toBeLessThan(html.indexOf('내용 받기'));
  expect(html).not.toContain('1 / 1');
  expect(html).toMatch(/pending[^>]*>.*화면 준비/);
  const later = renderToStaticMarkup(<Progress hero steps={[{ label: '내용 받기', done: 168506, total: 168506 }, { label: '화면 준비' }]} />);
  expect(later).toContain('>100<span');
  expect(later).toMatch(/active[^>]*>.*화면 준비/);
  expect(later).toContain('slide');
  expect(renderToStaticMarkup(<Progress hero steps={[{ label: '세기' }, { label: '내용' }]} />)).not.toContain('%');
});

it('hero: says the exact percent, treats counted work of zero as whole, and names each stage state for a screen reader', () => {
  const exact = renderToStaticMarkup(<Progress hero steps={[{ label: '내용', done: 29, total: 100 }]} />);
  expect(exact).toContain('>29<span');
  const nothing = renderToStaticMarkup(<Progress hero steps={[{ label: '그림', done: 0, total: 0 }, { label: '요약' }]} />);
  expect(nothing).toContain('>100<span');
  expect(nothing).toContain('aria-valuenow="100"');
  expect(nothing).toContain('끝남');
  expect(nothing).toContain('진행 중');
  expect(renderToStaticMarkup(<Progress hero steps={[{ label: '내용', done: 1, total: 2 }, { label: '요약' }]} />)).toContain('남음');
});
