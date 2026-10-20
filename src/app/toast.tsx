import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ApiFailure } from '../runtime/api';
import { noteProblem } from '../runtime/diagnostics';
import { describeFailure } from './common/failure';
import { UNDO } from './common/words';
import { SHORTCUTS, typing, useShortcut } from './shortcuts';
import { Toast, ToastStack, type ToastAction } from './ui';

type Action = { label: string; onClick: () => void };
type Extra = { detail?: string; action?: Action };
type From = { name: string; face: string | null };
type Notice = { key: number; message: string; detail?: string; tone: 'plain' | 'error'; action?: ToastAction; said?: { from: From; keep: () => void }; close: () => void; undo: boolean; life: number; ends: number };

export type Toasts = {
  show: (message: string, extra?: Extra) => void;
  error: (message: string, extra?: Extra) => void;
  // A full account is left to its standing notice (shell/Workspace), which says it once, and a write a restore dropped
  // to the toast that counts them (shell/Workspace); a prefixed failure, a whole task such as a backup, is still said.
  failed: (failure: ApiFailure, prefix?: string, words?: Parameters<typeof describeFailure>[1]) => void;
  // Deletion takes effect at once, and the toast offers 되돌리기 instead of a confirm dialog; Ctrl+Z does it too.
  // Answers what takes the toast away. A restore's result is returned, not chained: the toast says its failure itself.
  undoable: (message: string, undo: () => void | Promise<{ ok: true } | ApiFailure>, detail?: string) => () => void;
  // Long ones are cut until pressed, and once opened stay until closed.
  said: (from: From, text: string, tone: Notice['tone']) => void;
};

// More would only stack edges nobody reads.
const KEPT = 3;

function lifeOf(tone: Notice['tone'], text: string, action: boolean): number {
  const base = tone === 'error' ? 7000 : action ? 6000 : 4000;
  return Math.min(base + text.length * 40, tone === 'error' ? 14000 : 10000);
}

const ToastContext = createContext<Toasts | null>(null);
const FloorContext = createContext<((floor: HTMLElement | null) => void) | null>(null);

export type Standing = { message: string; detail: string };

// A mouse over the stack, or the focus in it, opens it and stops every notice's time, which runs on from where it stopped.
// standing: a notice in front of them for as long as the caller passes it, with no time of its own.
export function ToastProvider({ standing, children }: { standing: Standing | null; children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [held, setHeld] = useState(false);
  const [floor, setFloor] = useState<HTMLElement | null>(null);
  const heldSince = useRef(0);
  const toasts = useMemo<Toasts>(() => {
    let next = 0;
    const add = (message: string, tone: Notice['tone'], { detail, action, from }: Extra & { from?: From } = {}, undo = false) => {
      const key = ++next;
      if (tone === 'error') noteProblem(detail ? `${message} ${detail}` : message);
      const life = lifeOf(tone, `${message}${detail ?? ''}`, action !== undefined);
      const close = () => setNotices((all) => all.filter((notice) => notice.key !== key));
      const keep = () => setNotices((all) => all.map((notice) => (notice.key === key ? { ...notice, ends: Infinity } : notice)));
      const pressed = action && { ...action, onClick: () => (close(), action.onClick()), ...(undo && { keys: SHORTCUTS.undoToast.keys }) };
      // A notice with nothing to press, said again while it is up, stays one notice. One with an action or a speaker is
      // never merged: each carries its own 되돌리기 or words.
      const repeats = (notice: Notice) => !action && !from && !notice.action && !notice.said && notice.message === message && notice.detail === detail && notice.tone === tone;
      setNotices((all) => all.some(repeats) ? all : [{ key, message, detail, tone, action: pressed, said: from && { from, keep }, close, undo, life, ends: Date.now() + life }, ...all].slice(0, KEPT));
      return close;
    };
    const failed: Toasts['failed'] = (failure, prefix, words) => {
      if (failure.error !== 'storage-full' && (failure.error !== 'timeline-changed' || prefix)) add(prefix ?? describeFailure(failure, words), 'error', prefix ? { detail: describeFailure(failure, words) } : {});
    };
    const settle = (undo: Parameters<Toasts['undoable']>[1]) => () => void undo()?.then((result) => result.ok || failed(result, '되돌리지 못했어요.'));
    return {
      show: (message, extra) => void add(message, 'plain', extra),
      error: (message, extra) => void add(message, 'error', extra),
      failed,
      undoable: (message, undo, detail) => add(message, 'plain', { detail, action: { label: UNDO, onClick: settle(undo) } }, true),
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
      <FloorContext.Provider value={setFloor}>{children}</FloorContext.Provider>
      <ToastStack
        items={[
          ...(standing ? [{ key: 'standing', toast: <Toast message={standing.message} detail={standing.detail} tone="plain" life={0} paused={held} /> }] : []),
          ...notices.map(({ key, message, detail, tone, action, said, close, life }) => ({
            key,
            toast: <Toast message={message} detail={detail} tone={tone} action={action} from={said?.from} onKeep={said?.keep} onClose={close} life={life} paused={held} />,
            onClose: close,
          })),
        ]}
        held={held}
        onHold={hold}
        floor={floor}
      />
    </ToastContext.Provider>
  );
}

// The ref for what the toasts stand above while it is on screen: the chat's composer.
export function useToastFloor(): (floor: HTMLElement | null) => void {
  const setFloor = useContext(FloorContext);
  if (!setFloor) throw new Error('useToastFloor outside ToastProvider');
  return setFloor;
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
