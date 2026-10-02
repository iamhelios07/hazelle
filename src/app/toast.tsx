import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ApiFailure } from '../runtime/api';
import { describeFailure } from './common/failure';
import { SHORTCUTS, typing, useShortcut } from './shortcuts';
import { Toast, ToastStack, type ToastAction } from './ui';

type Action = { label: string; onClick: () => void };
type Extra = { detail?: string; action?: Action };
type From = { name: string; face: string | null };
// said: whose words the message is, and what its Toast does once they are opened.
type Notice = { key: number; message: string; detail?: string; tone: 'plain' | 'error'; action?: ToastAction; said?: { from: From; keep: () => void; close: () => void }; undo: boolean; life: number; ends: number };

export type Toasts = {
  // detail: what it was done to, under the message.
  show: (message: string, extra?: Extra) => void;
  // Something did not happen: message says what, detail why, action where to fix it.
  error: (message: string, extra?: Extra) => void;
  // Why a write failed, in failure.ts's words, led by prefix when it names what did not happen. A full account is
  // left to its standing notice (shell/Workspace), which says it once, and a write a restore dropped to the toast that
  // counts them (shell/Workspace); a prefixed failure, a whole task such as a backup, is still said.
  failed: (failure: ApiFailure, prefix?: string) => void;
  // Deletion takes effect at once, and the toast offers 되돌리기 instead of a confirm dialog; Ctrl+Z does it too.
  // Answers what takes the toast away.
  undoable: (message: string, undo: () => void, detail?: string) => () => void;
  // Someone else's words, such as a bot's, under their face and name. Long ones are cut until pressed, and once
  // opened stay until closed.
  said: (from: From, text: string, tone: Notice['tone']) => void;
};

// Three at most: more would only stack edges nobody reads.
const KEPT = 3;

// Long enough to read: a longer text stays longer, an action or an error longer still.
function lifeOf(tone: Notice['tone'], text: string, action: boolean): number {
  const base = tone === 'error' ? 7000 : action ? 6000 : 4000;
  return Math.min(base + text.length * 40, tone === 'error' ? 14000 : 10000);
}

const ToastContext = createContext<Toasts | null>(null);

export type Standing = { message: string; detail: string };

// Newest in front. Pointing at the stack opens it and stops every notice's time, which runs on from where it stopped.
// standing: a notice in front of them for as long as the caller passes it, with no time of its own.
export function ToastProvider({ standing, children }: { standing: Standing | null; children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [held, setHeld] = useState(false);
  const heldSince = useRef(0);
  const toasts = useMemo<Toasts>(() => {
    let next = 0;
    const add = (message: string, tone: Notice['tone'], { detail, action, from }: Extra & { from?: From } = {}, undo = false) => {
      const key = ++next;
      const life = lifeOf(tone, `${message}${detail ?? ''}`, action !== undefined);
      const close = () => setNotices((all) => all.filter((notice) => notice.key !== key));
      const keep = () => setNotices((all) => all.map((notice) => (notice.key === key ? { ...notice, ends: Infinity } : notice)));
      const pressed = action && { ...action, onClick: () => (close(), action.onClick()), ...(undo && { keys: SHORTCUTS.undoToast.keys }) };
      setNotices((all) => [{ key, message, detail, tone, action: pressed, said: from && { from, keep, close }, undo, life, ends: Date.now() + life }, ...all].slice(0, KEPT));
      return close;
    };
    return {
      show: (message, extra) => void add(message, 'plain', extra),
      error: (message, extra) => void add(message, 'error', extra),
      failed: (failure, prefix) => {
        if (failure.error !== 'storage-full' && (failure.error !== 'timeline-changed' || prefix)) add(prefix ?? describeFailure(failure), 'error', prefix ? { detail: describeFailure(failure) } : {});
      },
      undoable: (message, undo, detail) => add(message, 'plain', { detail, action: { label: '되돌리기', onClick: undo } }, true),
      said: (from, text, tone) => void add(text, tone, { from }),
    };
  }, []);

  useEffect(() => {
    if (held || notices.length === 0) return;
    const now = Date.now();
    const soonest = Math.min(...notices.map(({ ends }) => ends));
    // Only notices kept open are left, and those have no end.
    if (soonest === Infinity) return;
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
        items={[
          ...(standing ? [{ key: 'standing', toast: <Toast message={standing.message} detail={standing.detail} tone="plain" life={0} paused={held} /> }] : []),
          ...notices.map(({ key, message, detail, tone, action, said, life }) => ({
            key,
            toast: <Toast message={message} detail={detail} tone={tone} action={action} from={said?.from} onKeep={said?.keep} onClose={said?.close} life={life} paused={held} />,
          })),
        ]}
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

// undoable for a 되돌리기 that works through the screen offering it, such as an editor's own undo: its toasts leave
// with the screen, since pressed after that it would change a draft that is no longer shown. A 되돌리기 that writes
// to the store itself, such as putting a deleted thing back, outlives its screen and takes useToast's.
export function useOwnUndo(): Toasts['undoable'] {
  const toasts = useToast();
  const [offered] = useState(() => new Set<() => void>());
  useEffect(
    () => () => {
      for (const withdraw of offered) withdraw();
      offered.clear();
    },
    [offered],
  );
  return (message, undo, detail) => {
    const withdraw = toasts.undoable(message, undo, detail);
    offered.add(withdraw);
    return withdraw;
  };
}
