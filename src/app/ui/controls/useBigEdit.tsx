import { Maximize2 } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { formatKeys, pressed, type Chord } from '../foundation/keys';
import { Dialog } from '../overlays/Dialog';
import { IconButton } from './IconButton';
import styles from './useBigEdit.module.css';

const LABEL = '크게 편집';

const areaIn = (box: HTMLElement | null) => box?.querySelector('textarea');

// The same control over most of the screen, bound to the same value: there is no draft to save or cancel.
// big draws that second copy, which must not take the field's own ref: its unmount would clear a ref the field
// still answers to (the prompt editor's inserts).
export function useBigEdit(keys: readonly Chord[] | undefined, title: string, big: () => ReactNode) {
  const field = useRef<HTMLDivElement>(null);
  const inside = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const caret = useRef<[number, number] | null>(null);

  const toggle = (to: boolean) => {
    const from = areaIn(to ? field.current : inside.current);
    caret.current = from ? [from.selectionStart, from.selectionEnd] : null;
    setOpen(to);
  };
  // After the dialog's own focus moves: its trap focuses the × on open and hands focus back to the opener on close,
  // which is the corner button when it was pressed. The caret is kept, not taken: StrictMode runs both effects twice
  // and the trap's second run moves focus again.
  useEffect(() => {
    const at = caret.current;
    if (!at) return;
    const area = areaIn(open ? inside.current : field.current);
    area?.focus();
    area?.setSelectionRange(...at);
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
        <div ref={inside} className={styles.fill} onKeyDown={onKeyDown}>
          {big()}
        </div>
      </Dialog>
    ),
  };
}
