import { expect, it } from 'vitest';
import { cleanCss } from './Story';
import shadowCss from './Story.shadow.css?raw';

it("keeps the rule after an @import whose font URL holds a ;", () => {
  const css = "@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap');\n.vp{background:#ffffff;color:#222222}";
  expect(cleanCss(css, false)).toBe('@import none;\n.vp{background:#ffffff;color:#222222}');
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
