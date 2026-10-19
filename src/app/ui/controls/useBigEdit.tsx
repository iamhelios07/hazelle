import { Maximize2 } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { formatKeys, pressed, type Chord } from '../foundation/keys';
import { Dialog } from '../overlays/Dialog';
import { areaCaret, type Caret } from './codeLanguage';
import { IconButton } from './IconButton';
import styles from './useBigEdit.module.css';

const LABEL = '크게 편집';

// What the big copy hands back for the caret: a textarea through area, any other control through caret. Both are
// stable, so a ref callback built on them is not called again on every render, which would put the caret back.
export type BigCopy = { area: (element: HTMLTextAreaElement | null) => void; caret: (handle: Caret | null) => void };

// The same control over most of the screen, bound to the same value: there is no draft to save or cancel.
// big draws that second copy, which must not take the field's own ref: its unmount would clear a ref the field
// still answers to (the prompt editor's inserts).
export function useBigEdit(keys: readonly Chord[] | undefined, title: string, big: (copy: BigCopy) => ReactNode) {
  const field = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const caret = useRef<[number, number] | null>(null);
  const copy = useRef<Caret | null>(null);
  const opened = useRef(false);
  opened.current = open;

  const inline = () => {
    const area = field.current?.querySelector('textarea');
    return area ? areaCaret(area) : null;
  };
  const place = (target: Caret | null) => {
    const at = caret.current;
    if (!target || !at) return;
    target.focus();
    target.select(at);
  };
  const [bound] = useState<BigCopy>(() => {
    // A copy that loads after the dialog opens (the code editor) takes the caret when it arrives.
    const take = (handle: Caret | null) => {
      copy.current = handle;
      if (handle && opened.current) place(handle);
    };
    return { caret: take, area: (element) => take(element && areaCaret(element)) };
  });

  const toggle = (to: boolean) => {
    caret.current = (to ? inline() : copy.current)?.selection() ?? null;
    setOpen(to);
  };
  // After the dialog's own focus moves: its trap focuses the × on open and hands focus back to the opener on close,
  // which is the corner button when it was pressed. The caret is kept, not taken: StrictMode runs both effects twice
  // and the trap's second run moves focus again.
  useEffect(() => {
    place(open ? copy.current : inline());
  }, [open]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (!keys || !pressed(event, keys)) return;
    event.preventDefault();
    toggle(!open);
  };

  return {
    wrap: { ref: field, onKeyDown },
    button: keys && <IconButton icon={Maximize2} label={LABEL} title={`${LABEL} · ${formatKeys(keys)}`} size="xs" onClick={() => toggle(true)} />,
    dialog: open && (
      <Dialog title={title} size="full" onClose={() => toggle(false)}>
        <div className={styles.fill} onKeyDown={onKeyDown}>
          {big(bound)}
        </div>
      </Dialog>
    ),
  };
}
