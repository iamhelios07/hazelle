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
