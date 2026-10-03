import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ToastProvider, useOwnUndo, type Toasts } from './toast';

let shown: unknown[] = [];
vi.mock('./ui', () => ({
  Toast: () => null,
  ToastStack: ({ items }: { items: unknown[] }) => {
    shown = items;
    return null;
  },
}));

it('takes a screen\'s own 되돌리기 away when the screen is left', async () => {
  // A null-rendering probe needs only React's host container, not a browser or a DOM implementation.
  const document = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null, defaultView: { HTMLIFrameElement: class {}, addEventListener() {}, removeEventListener() {} }, documentElement: { namespaceURI: 'http://www.w3.org/1999/xhtml' } };
  const container = { nodeType: 1, tagName: 'DIV', namespaceURI: 'http://www.w3.org/1999/xhtml', ownerDocument: document, addEventListener() {}, removeEventListener() {}, textContent: '' } as unknown as HTMLElement;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', document.defaultView);
  vi.stubGlobal('document', document);
  let undoable: Toasts['undoable'];
  function Editor() {
    undoable = useOwnUndo();
    return null;
  }
  const root = createRoot(container);
  const render = (open: boolean) => root.render(<ToastProvider standing={null}>{open && <Editor />}</ToastProvider>);
  try {
    await act(() => render(true));
    await act(() => void undoable!('블록을 뺐어요.', () => {}));
    expect(shown).toHaveLength(1);
    await act(() => render(false));
    expect(shown).toHaveLength(0);
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
