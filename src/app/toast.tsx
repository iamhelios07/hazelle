import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Toast } from './ui';

type Notice = { message: string; action?: { label: string; onClick: () => void } };

const ToastContext = createContext<(notice: Notice) => void>(() => {});
const SlotContext = createContext<(slot: HTMLElement | null) => void>(() => {});

// One toast at a time; a new one replaces the old. It closes by itself, and its action closes it too.
// It floats at the foot of the page, or sits in a ToastSlot when the page has one, such as the chat's
// place above its composer.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<(Notice & { key: number }) | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const show = useCallback((next: Notice) => setNotice({ ...next, key: Date.now() }), []);
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
    <ToastContext.Provider value={show}>
      <SlotContext.Provider value={setSlot}>
        {children}
        {toast && (slot ? createPortal(toast, slot) : toast)}
      </SlotContext.Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

export function ToastSlot() {
  return <div ref={useContext(SlotContext)} />;
}
