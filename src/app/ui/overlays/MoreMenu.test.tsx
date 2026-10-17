import { act, type MouseEvent } from 'react';
import { expect, it, vi } from 'vitest';
import { probeRoot } from '../probe';
import { useMenuHandle } from './Menu';
import { useMenuSlot } from './MoreMenu';

const rightClick = () => ({ clientX: 120, clientY: 340, preventDefault: vi.fn() }) as unknown as MouseEvent & { preventDefault: ReturnType<typeof vi.fn> };

it("opens the held ⋯ at the pointer on a right-click, and leaves a right-click inside the open menu to the browser", async () => {
  const root = probeRoot();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  let slot: ReturnType<typeof useMenuSlot>;
  let handle: ReturnType<typeof useMenuHandle>;
  function Probe() {
    slot = useMenuSlot();
    handle = useMenuHandle();
    slot.held.current = handle;
    return null;
  }
  try {
    await act(() => root.render(<Probe />));
    const first = rightClick();
    slot!.onContextMenu(first);
    expect(first.preventDefault).toHaveBeenCalled();
    expect(handle!.read()).toEqual({ open: true, from: null, at: { x: 120, y: 340 } });

    const inside = rightClick();
    slot!.onContextMenu(inside);
    expect(inside.preventDefault).not.toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
