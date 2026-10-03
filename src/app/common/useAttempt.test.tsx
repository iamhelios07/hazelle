import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useAttempt } from './useAttempt';

it('stops the signal its task was given when the screen is left', async () => {
  // A null-rendering probe needs only React's host container, not a browser or a DOM implementation.
  const document = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null, defaultView: { HTMLIFrameElement: class {} }, documentElement: { namespaceURI: 'http://www.w3.org/1999/xhtml' } };
  const container = { nodeType: 1, tagName: 'DIV', namespaceURI: 'http://www.w3.org/1999/xhtml', ownerDocument: document, addEventListener() {}, removeEventListener() {}, textContent: '' } as unknown as HTMLElement;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', document.defaultView);
  vi.stubGlobal('document', document);
  let attempt: ReturnType<typeof useAttempt>;
  function Probe() {
    attempt = useAttempt();
    return null;
  }
  const root = createRoot(container);
  try {
    await act(() => root.render(<Probe />));
    let seen: AbortSignal | undefined;
    await act(() => void attempt!.run((signal) => new Promise(() => void (seen = signal))));
    expect(seen!.aborted).toBe(false);
    await act(() => root.unmount());
    expect(seen!.aborted).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});
