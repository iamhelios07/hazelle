import { X } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { IconButton } from '../controls/IconButton';
import { useLayer } from '../overlays/layers';
import styles from './SidePeek.module.css';

type Props = {
  label: string;
  // The tab's word, when shorter than label, such as 정보 for 답장 정보.
  tab?: string;
  // The drawer's id, which buttons elsewhere that hold it open name (IconButton's controls): a press on them is not
  // outside, so the one that holds it lets go of it again, and another keeps it held.
  id?: string;
  // Held open by a key or a tap; pointing at the tab shows it only while the pointer stays.
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: ReactNode;
  children: ReactNode;
};

// The story's right edge, between the header and the composer, where SidePeeks stack their tabs. ChatFrame places it.
export function SidePeeks({ children }: { children: ReactNode }) {
  return <div className={styles.peeks}>{children}</div>;
}

// A tab at the story's right edge whose drawer slides over the story while the tab or the drawer is pointed at,
// such as 상태. Held open, it has its own close: on a phone the drawer covers nearly all the story, and what is left
// outside it is the composer, whose press raises the keyboard.
export function SidePeek({ label, tab = label, id, open, onOpenChange, actions, children }: Props) {
  const root = useRef<HTMLDivElement>(null);

  useLayer(open, {
    outside: (target) => !root.current?.contains(target) && !(id && (target instanceof Element ? target : target.parentElement)?.closest(`[aria-controls="${id}"]`)),
    close: () => onOpenChange(false),
  });

  return (
    <div ref={root} className={open ? `${styles.peek} ${styles.open}` : styles.peek}>
      <button type="button" className={styles.tab} aria-expanded={open} aria-controls={id} onClick={() => onOpenChange(!open)}>
        {tab}
      </button>
      <aside id={id} className={styles.drawer} aria-label={label}>
        <div className={styles.head}>
          <h2 className={styles.title}>{label}</h2>
          {actions}
          {open && <IconButton icon={X} size="xs" label={`${label} 닫기`} onClick={() => onOpenChange(false)} />}
        </div>
        {children}
      </aside>
    </div>
  );
}
