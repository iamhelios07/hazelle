import { expect, it } from 'vitest';
import { staticHtml, type Look } from './snapshot';

// Tests run without a DOM: nodes and computed styles are stubbed as the walk reads them.
type Fake = { nodeType: 1; localName: string; attributes: { name: string; value: string }[]; childNodes: (Fake | { nodeType: 3; data: string })[]; shadowRoot: { childNodes: Fake['childNodes'] } | null; style: Record<string, string> };
const element = (localName: string, style: Record<string, string>, childNodes: Fake['childNodes'] = [], attributes: Fake['attributes'] = [], shadowRoot: Fake['shadowRoot'] = null): Fake => ({ nodeType: 1, localName, attributes, childNodes, shadowRoot, style });
const text = (data: string) => ({ nodeType: 3 as const, data });

const look: Look = {
  style: (node) => ({ getPropertyValue: (property: string) => (node as unknown as Fake).style[property] ?? '' }),
  reference: (name) => element(name, name === 'p' ? { display: 'block', 'margin-top': '16px' } : { display: 'inline' }) as unknown as Element,
  lost: () => [],
};

it('walks into shadow roots, keeps allowed attributes and loading sources only, escapes text, and writes only the styles that differ', () => {
  const story = element('div', { display: 'block', color: 'red' }, [element('span', { display: 'inline', color: 'blue' }, [text('hidden light child')])], [], {
    childNodes: [
      element('p', { display: 'block', color: 'red', 'margin-top': '16px', 'background-color': 'black' }, [text('a < b & "c"')], [{ name: 'class', value: 'x' }, { name: 'onclick', value: 'run()' }, { name: 'risu-btn', value: 'go' }, { name: 'title', value: 'say "hi"' }]),
      element('img', { display: 'inline', color: 'red', width: '120px' }, [], [{ name: 'src', value: 'data:image/png;base64,AA' }, { name: 'alt', value: 'pic' }]),
      element('img', { display: 'inline', color: 'red', width: '80px' }, [], [{ name: 'src', value: 'blob:https://hazelle.app/1' }]),
      element('style', { display: 'none' }, [text('p { color: red }')]),
    ],
  });
  const root = element('section', { display: 'block', color: 'red', 'font-size': '16px' }, [story]);
  expect(staticHtml(root as unknown as Element, look).html).toBe(
    '<section style="color:red;font-size:16px;display:block">' +
      '<div style="display:block">' +
      '<p title="say &quot;hi&quot;" style="background-color:black">a &lt; b &amp; "c"</p>' +
      '<img src="data:image/png;base64,AA" alt="pic" style="width:120px">' +
      '<img style="width:80px">' +
      '</div>' +
      '</section>',
  );
});

it("keeps an SVG shape's drawing attributes and counts a grid template as lost", () => {
  const svgNamed = (fake: Fake) => ({ ...fake, namespaceURI: 'http://www.w3.org/2000/svg' });
  const path = svgNamed(element('path', { display: 'inline' }, [], [{ name: 'd', value: 'M0 0L9 9' }, { name: 'onclick', value: 'run()' }]));
  const svg = svgNamed(element('svg', { display: 'inline', width: '24px', height: '24px' }, [path], [{ name: 'viewBox', value: '0 0 24 24' }]));
  const grid = element('div', { display: 'grid', 'grid-template-columns': '300px 300px' }, [svg]);
  const { html, rules } = staticHtml(grid as unknown as Element, look);
  expect(html).toBe('<div style="display:grid"><svg viewBox="0 0 24 24" style="width:24px;height:24px"><path d="M0 0L9 9"></path></svg></div>');
  expect(rules).toBe(1);
});
