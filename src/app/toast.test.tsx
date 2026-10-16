import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { ToastProvider, useOwnUndo, useToast, type Toasts } from './toast';
import { probeRoot } from './ui/probe';

let shown: unknown[] = [];
vi.mock('./ui', () => ({
  Toast: () => null,
  ToastStack: ({ items }: { items: unknown[] }) => {
    shown = items;
    return null;
  },
}));

it('takes a screen\'s own 되돌리기 away when the screen is left', async () => {
  let undoable: Toasts['undoable'];
  function Editor() {
    undoable = useOwnUndo();
    return null;
  }
  const root = probeRoot();
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

it('shows a plain notice said again while it is up once, but every 되돌리기', async () => {
  let toasts: Toasts;
  function Probe() {
    toasts = useToast();
    return null;
  }
  const root = probeRoot();
  try {
    await act(() => root.render(<ToastProvider standing={null}><Probe /></ToastProvider>));
    await act(() => { toasts!.show('계정을 복원해서 다시 열었어요'); toasts!.show('계정을 복원해서 다시 열었어요'); });
    expect(shown).toHaveLength(1);
    await act(() => { toasts!.undoable('삭제했어요', () => {}); toasts!.undoable('삭제했어요', () => {}); });
    expect(shown).toHaveLength(3);
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

it('says a 되돌리기 whose restore failed, with the one prefix', async () => {
  let toasts: Toasts;
  function Probe() {
    toasts = useToast();
    return null;
  }
  const props = () => (shown as { toast: { props: { message: string; detail?: string; action?: { onClick: () => void } } } }[]).map(({ toast }) => toast.props);
  const root = probeRoot();
  try {
    await act(() => root.render(<ToastProvider standing={null}><Probe /></ToastProvider>));
    await act(() => void toasts!.undoable('삭제했어요', async () => ({ ok: false, error: 'gone' })));
    await act(async () => props()[0]!.action!.onClick());
    expect(props()).toEqual([expect.objectContaining({ message: '되돌리지 못했어요.', detail: expect.any(String) })]);
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
