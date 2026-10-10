import { expect, it, vi } from 'vitest';
import { mathFor } from './math';

const katex = vi.hoisted(() => ({ imported: false }));
vi.mock('katex', async (original) => {
  katex.imported = true;
  return original();
});

it('loads KaTeX only for a formula, draws it as inline MathML, and leaves one KaTeX cannot read as written', async () => {
  expect(mathFor('<p>$$x^2$$ costs $5</p>')).toBeTypeOf('function');
  expect(katex.imported).toBe(false);

  const html = '<p><span data-tex>$$x^2$$</span> <span data-tex>$$\\frac{$$</span> <span data-tex>$$a &lt; b$$</span></p>';
  await mathFor(html);
  expect(katex.imported).toBe(true);
  const drawn = (mathFor(html) as (html: string) => string)(html);
  expect(drawn).toContain(
    '<p><span class="katex"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><msup><mi>x</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span> <span data-tex>$$\\frac{$$</span> ',
  );
  expect(drawn).toContain('<mo>&lt;</mo>');
});
