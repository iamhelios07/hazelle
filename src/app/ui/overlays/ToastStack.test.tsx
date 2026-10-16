import { act, type PointerEvent } from 'react';
import { expect, it, vi } from 'vitest';
import { probeRoot } from '../probe';
import { useHold } from './ToastStack';

// The stack's element, with the focus in it while it is on its one button.
const button = {};
const element = { contains: (node: unknown) => node === button } as unknown as HTMLDivElement;
const mouse = { pointerType: 'mouse' } as PointerEvent;
const focus = (node: unknown) => Object.assign(document, { activeElement: node });

function stack() {
  const hold = vi.fn();
  let holding: ReturnType<typeof useHold>;
  function Probe({ held, shown }: { held: boolean; shown: HTMLDivElement | null }) {
    holding = useHold(held, hold);
    holding.ref.current = shown;
    return null;
  }
  const root = probeRoot();
  return {
    hold,
    handlers: () => holding,
    show: (held: boolean, shown: HTMLDivElement | null = element) => act(() => root.render(<Probe held={held} shown={shown} />)),
    end: async () => {
      await act(() => root.unmount());
      vi.unstubAllGlobals();
    },
  };
}

it('ends a hold the focus began once the focused notice is taken away, but not while the mouse is over the stack', async () => {
  const { hold, handlers, show, end } = stack();
  try {
    await show(false);
    focus(button);
    handlers().onFocus();
    await show(true);
    expect(hold).not.toHaveBeenCalledWith(false);
    focus(null);
    await show(true);
    expect(hold).toHaveBeenLastCalledWith(false);
    hold.mockClear();
    handlers().onPointerEnter(mouse);
    focus(button);
    handlers().onFocus();
    await show(true);
    focus(null);
    await show(true);
    expect(hold).not.toHaveBeenCalledWith(false);
  } finally {
    await end();
  }
});

it('ends a hold once its last notice left from under the pointer', async () => {
  const { hold, handlers, show, end } = stack();
  try {
    await show(false);
    handlers().onPointerEnter(mouse);
    await show(true);
    await show(true, null);
    expect(hold).toHaveBeenLastCalledWith(false);
  } finally {
    await end();
  }
});
