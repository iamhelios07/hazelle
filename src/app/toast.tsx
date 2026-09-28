import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ApiFailure } from '../runtime/api';
import { describeFailure } from './common/failure';
import { Toast } from './ui';

type Action = { label: string; onClick: () => void };
type Notice = { message: string; action?: Action; key: number };

export type Toasts = {
  show: (message: string, action?: Action) => void;
  // Why a write failed, in failure.ts's words, led by prefix when it names what did not happen.
  failed: (failure: ApiFailure, prefix?: string) => void;
  // design F3: deletion takes effect at once, and the toast offers 되돌리기 instead of a confirm dialog.
  undoable: (message: string, undo: () => void) => void;
};

const ToastContext = createContext<Toasts | null>(null);
const SlotContext = createContext<(slot: HTMLElement | null) => void>(() => {});

// One toast at a time; a new one replaces the old. It closes by itself, and its action closes it too.
// It floats at the foot of the page, or sits in a ToastSlot when the page has one, such as the chat's
// place above its composer.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const toasts = useMemo<Toasts>(() => {
    const show = (message: string, action?: Action) => setNotice({ message, action, key: Date.now() });
    return {
      show,
      failed: (failure, prefix) => show(prefix ? `${prefix} ${describeFailure(failure)}` : describeFailure(failure)),
      undoable: (message, undo) => show(message, { label: '되돌리기', onClick: undo }),
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  const action = notice?.action;
  const toast = notice && (
    <Toast
      key={notice.key}
      floating={!slot}
      message={notice.message}
      action={action && { label: action.label, onClick: () => (setNotice(null), action.onClick()) }}
    />
  );
  return (
    <ToastContext.Provider value={toasts}>
      <SlotContext.Provider value={setSlot}>
        {children}
        {toast && (slot ? createPortal(toast, slot) : toast)}
      </SlotContext.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): Toasts {
  const toasts = useContext(ToastContext);
  if (!toasts) throw new Error('useToast outside ToastProvider');
  return toasts;
}

export function ToastSlot() {
  return <div ref={useContext(SlotContext)} />;
}
