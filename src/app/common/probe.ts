import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';

// A null-rendering probe needs only React's host container, not a browser or a DOM implementation. The test unmounts
// the root and unstubs the globals.
export function probeRoot(): Root {
  const document = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null, defaultView: { HTMLIFrameElement: class {}, addEventListener() {}, removeEventListener() {} }, documentElement: { namespaceURI: 'http://www.w3.org/1999/xhtml' } };
  const container = { nodeType: 1, tagName: 'DIV', namespaceURI: 'http://www.w3.org/1999/xhtml', ownerDocument: document, addEventListener() {}, removeEventListener() {}, textContent: '' } as unknown as HTMLElement;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', document.defaultView);
  vi.stubGlobal('document', document);
  return createRoot(container);
}
