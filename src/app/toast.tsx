import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Toast } from './ui';

type Notice = { message: string; action?: { label: string; onClick: () => void } };

const ToastContext = createContext<(notice: Notice) => void>(() => {});

// One toast at a time; a new one replaces the old. It closes by itself, and its action closes it too.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<(Notice & { key: number }) | null>(null);
  const show = useCallback((next: Notice) => setNotice({ ...next, key: Date.now() }), []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  const action = notice?.action;
  return (
    <ToastContext.Provider value={show}>
      {children}
      {notice && (
        <Toast
          key={notice.key}
          message={notice.message}
          action={action && { label: action.label, onClick: () => (setNotice(null), action.onClick()) }}
        />
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
