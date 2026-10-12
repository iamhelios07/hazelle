import { expect, it } from 'vitest';
import { cleanCss } from './Story';

it("keeps the rule after an @import whose font URL holds a ;", () => {
  const css = "@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap');\n.vp{background:#ffffff;color:#222222}";
  expect(cleanCss(css, false)).toBe('@import none;\n.vp{background:#ffffff;color:#222222}');
});
