import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ApiFailure } from '../runtime/api';
import { describeFailure } from './common/failure';
import { SHORTCUTS, typing, useShortcut } from './shortcuts';
import { Toast, ToastStack, type ToastAction } from './ui';

type Action = { label: string; onClick: () => void };
type Extra = { detail?: string; action?: Action };
type Notice = { key: number; message: string; detail?: string; tone: 'plain' | 'error'; action?: ToastAction; undo: boolean; life: number; ends: number };

export type Toasts = {
  // detail: what it was done to, under the message.
  show: (message: string, extra?: Extra) => void;
  // Something did not happen: message says what, detail why, action where to fix it.
  error: (message: string, extra?: Extra) => void;
  // Why a write failed, in failure.ts's words, led by prefix when it names what did not happen.
  failed: (failure: ApiFailure, prefix?: string) => void;
  // Deletion takes effect at once, and the toast offers 되돌리기 instead of a confirm dialog; Ctrl+Z does it too.
  undoable: (message: string, undo: () => void, detail?: string) => void;
};

// Three at most: more would only stack edges nobody reads.
const KEPT = 3;

// Long enough to read: a longer text stays longer, an action or an error longer still.
function lifeOf(tone: Notice['tone'], text: string, action: boolean): number {
  const base = tone === 'error' ? 7000 : action ? 6000 : 4000;
  return Math.min(base + text.length * 40, tone === 'error' ? 14000 : 10000);
}

const ToastContext = createContext<Toasts | null>(null);

// Newest in front. Pointing at the stack opens it and stops every notice's time, which runs on from where it stopped.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [held, setHeld] = useState(false);
  const heldSince = useRef(0);
  const toasts = useMemo<Toasts>(() => {
    let next = 0;
    const add = (message: string, tone: Notice['tone'], { detail, action }: Extra = {}, undo = false) => {
      const key = ++next;
      const life = lifeOf(tone, `${message}${detail ?? ''}`, action !== undefined);
      const close = () => setNotices((all) => all.filter((notice) => notice.key !== key));
      const pressed = action && { ...action, onClick: () => (close(), action.onClick()), ...(undo && { keys: SHORTCUTS.undoToast.keys }) };
      setNotices((all) => [{ key, message, detail, tone, action: pressed, undo, life, ends: Date.now() + life }, ...all].slice(0, KEPT));
    };
    return {
      show: (message, extra) => add(message, 'plain', extra),
      error: (message, extra) => add(message, 'error', extra),
      failed: (failure, prefix) => add(prefix ?? describeFailure(failure), 'error', prefix ? { detail: describeFailure(failure) } : {}),
      undoable: (message, undo, detail) => add(message, 'plain', { detail, action: { label: '되돌리기', onClick: undo } }, true),
    };
  }, []);

  useEffect(() => {
    if (held || notices.length === 0) return;
    const now = Date.now();
    const soonest = Math.min(...notices.map(({ ends }) => ends));
    const timer = setTimeout(() => setNotices((all) => all.filter(({ ends }) => ends > Date.now())), Math.max(0, soonest - now));
    return () => clearTimeout(timer);
  }, [held, notices]);

  const hold = (on: boolean) => {
    if (on === held) return;
    if (on) heldSince.current = Date.now();
    else {
      const stopped = Date.now() - heldSince.current;
      setNotices((all) => all.map((notice) => ({ ...notice, ends: notice.ends + stopped })));
    }
    setHeld(on);
  };

  // The newest 되돌리기 on screen; typing keeps the field's own undo.
  useShortcut('undoToast', (event) => {
    const newest = notices.find(({ undo }) => undo);
    if (typing(event) || !newest) return false;
    newest.action!.onClick();
  });

  return (
    <ToastContext.Provider value={toasts}>
      {children}
      <ToastStack
        items={notices.map(({ key, message, detail, tone, action, life }) => ({
          key,
          toast: <Toast message={message} detail={detail} tone={tone} action={action} life={life} paused={held} />,
        }))}
        onHold={hold}
      />
    </ToastContext.Provider>
  );
}

export function useToast(): Toasts {
  const toasts = useContext(ToastContext);
  if (!toasts) throw new Error('useToast outside ToastProvider');
  return toasts;
}
