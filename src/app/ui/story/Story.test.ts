import { expect, it } from 'vitest';
import { cleanCss, setStylesAside } from './Story';
import shadowCss from './Story.shadow.css?raw';

it("keeps the rule after an @import whose font URL holds a ;", () => {
  const css = "@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap');\n.vp{background:#ffffff;color:#222222}";
  expect(cleanCss(css, false)).toBe('@import none;\n.vp{background:#ffffff;color:#222222}');
});

it('takes an url( never closed to the end, in one pass however many follow', () => {
  expect(cleanCss('a{background:url(x.png)} b{background:url(https://e', false)).toBe('a{background:none} b{background:none');
  const start = performance.now();
  expect(cleanCss('url('.repeat(64 * 1024), false)).toBe('none');
  expect(performance.now() - start).toBeLessThan(200);
});

it('sets every style attribute of a tag aside, in one pass over tags never closed', () => {
  expect(setStylesAside('<P STYLE="a" title="x style=y" style =b>style=c</p><br\nstyle=d>')).toBe('<P data-style="a" title="x data-style=y" data-style =b>style=c</p><br\ndata-style=d>');
  const start = performance.now();
  setStylesAside('<div title="' + '<b '.repeat(64 * 1024));
  expect(performance.now() - start).toBeLessThan(200);
});

it("lets any rule of the bot's beat the story's own looks", () => {
  const open = shadowCss.indexOf('@layer {');
  let close = shadowCss.indexOf('{', open);
  for (let depth = 1; depth > 0; ) {
    const char = shadowCss[++close];
    if (char === '{') depth++;
    if (char === '}') depth--;
  }
  const unlayered = shadowCss.slice(0, open) + shadowCss.slice(close + 1);
  expect(shadowCss.slice(open, close)).toContain('mark[risu-mark]');
  expect(unlayered).not.toMatch(/\bem\b|mark\[|margin|\[data-picture\] > img/);
});
